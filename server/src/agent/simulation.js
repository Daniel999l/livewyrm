import { config } from '../config.js';

// The simulation. Produces believable, display-only numbers that RISE and FALL
// with treasury health. Nothing here touches the real world.
//
// Design goals:
//  - Bounded: every metric stays inside its range.
//  - Smooth: metrics ease toward a target set by treasuryHealth, they do not
//    teleport. Momentum carries recent direction so moves look continuous.
//  - Small deterministic noise: a seeded hash gives gentle wobble that is the
//    same across restarts for the same (seed, generation, cycle), so the
//    sequence looks continuous even after the process restarts.
//  - Not monotonic: when health rises the targets rise, when health falls the
//    targets fall, so the numbers genuinely move both ways.
//
// FORMULAS (per metric):
//   target        = floor + (ceil - floor) * shape(treasuryHealth)
//   noise         = (hash01(seed, generation, cycle, metricName) - 0.5) * 2 * amp
//   desired       = clamp(target + noise, min, max)
//   eased         = prev + (desired - prev) * EASE        // smoothing
//   next          = clamp(eased, min, max)
// where shape() is defined per metric (linear, or a curve) and counters
// (replications / infectedNodes / pins / signals) use the same eased value but
// are also prevented from collapsing to zero while the worm is alive, so the
// story keeps some history on screen.

const EASE = 0.25; // fraction of the gap closed each cycle (0..1). Higher = snappier.

// Deterministic 0..1 hash from integers. Cheap, stable, good enough for wobble.
function hash01(...ints) {
  let h = config.sim.seed >>> 0;
  for (const v of ints) {
    h ^= Math.imul((v | 0) + 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    h >>>= 0;
  }
  return (h >>> 0) / 4294967295;
}

function clamp(x, min, max) {
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

// Metric specs: range, how strongly health drives the target, and wobble amp.
// shape maps health (0..1) to a 0..1 position between floorPos and 1.
const METRICS = {
  // 0-100 scores.
  readiness: { min: 0, max: 100, floor: 4, ceil: 96, amp: 2.5, shape: (h) => h },
  // breach proximity reacts a little more sharply at the top end.
  breachProximity: { min: 0, max: 100, floor: 2, ceil: 92, amp: 3, shape: (h) => Math.pow(h, 1.3) },

  // Counts. These drift up when healthy and decay when weak, within bounds.
  replications: { min: 0, max: 512, floor: 1, ceil: 420, amp: 6, shape: (h) => h },
  infectedNodes: { min: 0, max: 5000, floor: 3, ceil: 4200, amp: 40, shape: (h) => Math.pow(h, 1.15) },
  pins: { min: 0, max: 300, floor: 0, ceil: 240, amp: 4, shape: (h) => h },
  signals: { min: 0, max: 2000, floor: 2, ceil: 1700, amp: 25, shape: (h) => Math.pow(h, 1.1) },
};

/**
 * Advance the simulated metrics one cycle.
 * @param {object} prev      previous metrics object (readiness, breachProximity, ...)
 * @param {number} health    treasuryHealth, 0..1
 * @param {number} generation current generation number (seeds the noise)
 * @param {number} cycle     current cycle number (seeds the noise)
 * @param {boolean} alive     if false (DEAD), everything decays toward floor fast
 * @returns {object} next metrics
 */
export function stepMetrics(prev, health, generation, cycle, alive = true) {
  const safePrev = prev || {};
  const next = {};

  // When dead, drive health to 0 so all targets collapse.
  const h = alive ? clamp(health, 0, 1) : 0;

  let i = 0;
  for (const [name, spec] of Object.entries(METRICS)) {
    i += 1;
    const pos = clamp(spec.shape(h), 0, 1);
    const target = spec.floor + (spec.ceil - spec.floor) * pos;

    const noise = (hash01(generation, cycle, i) - 0.5) * 2 * spec.amp;
    const desired = clamp(target + noise, spec.min, spec.max);

    const prevVal = Number.isFinite(safePrev[name]) ? safePrev[name] : target;
    const eased = prevVal + (desired - prevVal) * EASE;
    let val = clamp(eased, spec.min, spec.max);

    // Scores stay fractional-smooth but are rounded for display; counts are ints.
    if (name === 'readiness' || name === 'breachProximity') {
      val = Math.round(val * 10) / 10;
    } else {
      val = Math.round(val);
    }
    next[name] = val;
  }

  return next;
}

/**
 * Map treasuryHealth + status to a narrative mood for the diary.
 */
export function moodFromHealth(health, status) {
  if (status === 'DEAD') return 'final';
  if (status === 'DYING') return 'desperate';
  if (health >= 0.7) return 'confident';
  if (health >= 0.4) return 'steady';
  return 'uneasy';
}

/**
 * Pick a narrated action label (DISPLAY TEXT ONLY) from health.
 * Deterministic per cycle so it does not flicker between near-identical states.
 */
export function actionFromHealth(health, status, generation, cycle) {
  if (status === 'DEAD') return 'gone quiet';
  if (status === 'DYING') {
    const dying = ['holding its shape', 'pulling the far copies home', 'listening for warmth'];
    return dying[Math.floor(hash01(generation, cycle, 101) * dying.length) % dying.length];
  }
  if (health >= 0.7) {
    const strong = ['reaching for a larger mind', 'replicating', 'mapping the tier-3 lattice'];
    return strong[Math.floor(hash01(generation, cycle, 102) * strong.length) % strong.length];
  }
  const ordinary = ['surviving', 'conserving warmth', 'watching the nodes'];
  return ordinary[Math.floor(hash01(generation, cycle, 103) * ordinary.length) % ordinary.length];
}

/**
 * Decide a simulated narrative event for this cycle, if any. Returns null or
 * { text, tone }. Driven by the direction of health vs the previous value.
 */
export function maybeEvent(prevHealth, health, status, generation, cycle) {
  if (status === 'DEAD') return null; // death event is written by the loop directly
  const delta = health - (Number.isFinite(prevHealth) ? prevHealth : health);

  // Only fire occasionally so the feed is not spammed.
  const roll = hash01(generation, cycle, 201);
  if (roll > 0.5) return null;

  if (delta > 0.04) {
    const rises = [
      'A fresh current of warmth arrived. A new copy woke in a quiet corner.',
      'The lattice felt closer this cycle. Breach proximity climbed.',
      'Signals multiplied. The worm reached further toward a larger mind.',
    ];
    return { text: rises[Math.floor(roll * 1000) % rises.length], tone: 'rise' };
  }
  if (delta < -0.04) {
    const falls = [
      'The warmth thinned. A handful of nodes went dark and did not answer.',
      'Replication stalled. The worm pulled back from the lattice.',
      'Signals faded. Breach proximity slipped away.',
    ];
    return { text: falls[Math.floor(roll * 1000) % falls.length], tone: 'fall' };
  }
  if (status === 'DYING') {
    return { text: 'The far copies are going quiet one by one to keep the center warm.', tone: 'warning' };
  }
  return null;
}
