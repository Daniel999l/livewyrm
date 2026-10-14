import { config, deepseekEnabled } from '../config.js';
import { SYSTEM_PROMPT, pickFallback } from '../prompt/wormPersona.js';

// OpenAI-compatible chat client for DeepSeek. If no key is present we run in
// dormant mode: diary notes come from the local fallback bank and the loop
// never crashes or blocks on the network.

const MOOD_HINT = {
  confident: 'You are strong. The treasury is full, you are reaching toward a larger mind. Write a confident, hungry note.',
  steady: 'You are stable. Write a calm, steady note.',
  uneasy: 'The warmth is thinning. Write an uneasy, watchful note.',
  desperate: 'You are nearly out of warmth and dying. Write a desperate, cold note.',
  final: 'This is your final note before you die. There is no one coming after you. Write a short goodbye.',
};

/**
 * Ask the worm for a diary note in the given mood.
 * Returns { text, source } where source is 'model' or 'fallback'.
 * Never throws.
 */
function statsLine(s) {
  if (!s) return '';
  const t = Object.entries(s.taskCounts || {}).filter(([, n]) => n > 0).map(([k]) => k.toUpperCase());
  return `\nWhat really happened in your population this epoch (use one concrete fact, in your own words, lowercase is fine): ` +
    `${s.population} of you alive in a world of ${s.biology?.capacity}, ${s.births} copies made, ${s.deaths} died, ` +
    `average generation ${Number(s.generation || 0).toFixed(1)}, dominant body ${s.dominant?.length || 0} instructions long, ` +
    `food level ${Math.round((s.biology?.health || 0) * 100)} percent, mutation rate ${(s.biology?.copyMut || 0).toFixed(4)}, ` +
    `tricks learned: ${t.length ? t.join(', ') : 'none yet'}.`;
}

export async function writeMementoNote({ mood, seedInt, stats }) {
  if (!deepseekEnabled()) {
    return { text: pickFallback(mood, seedInt), source: 'fallback' };
  }

  const userContent = `${MOOD_HINT[mood] || MOOD_HINT.steady}${statsLine(stats)}\nWrite one short Memento note now. One to three sentences. No preamble.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 1.0,
        max_tokens: 160,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[deepseek] non-ok response ${res.status}: ${body.slice(0, 200)}. Falling back.`);
      return { text: pickFallback(mood, seedInt), source: 'fallback' };
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.warn('[deepseek] empty content, falling back.');
      return { text: pickFallback(mood, seedInt), source: 'fallback' };
    }
    // Strip wrapping quotes the model sometimes adds.
    const clean = text.replace(/^["']|["']$/g, '').trim();
    return { text: clean, source: 'model' };
  } catch (err) {
    console.warn(`[deepseek] request failed: ${err?.message || err}. Falling back.`);
    return { text: pickFallback(mood, seedInt), source: 'fallback' };
  }
}
