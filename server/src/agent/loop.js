import { config, deepseekEnabled } from '../config.js';
import { Worm } from '../models/Worm.js';
import { MementoNote } from '../models/MementoNote.js';
import { CycleLog } from '../models/CycleLog.js';
import { EventLog } from '../models/EventLog.js';
import { Graveyard } from '../models/Graveyard.js';
import { getTreasuryBalance, computeLifeModel } from '../services/treasury.js';
import { writeMementoNote } from '../services/deepseek.js';
import { runEpoch, labelsFromStats, avidaAvailable } from './avida.js';
import { OrganismSnapshot } from '../models/OrganismSnapshot.js';
import {
  moodFromHealth,
  actionFromHealth,
  maybeEvent,
} from './simulation.js';

let timer = null;
let epochTimer = null;
let epochRunning = false;
let lastEpoch = null; // real stats from the latest Avida epoch
let running = false;
let halted = false;

// Track peaks across a generation for the headstone.
let peakReadiness = 0;
let peakBreachProximity = 0;

/**
 * Ensure a worm exists. Fresh DB -> one ALIVE worm at generation 1.
 */
export async function ensureWorm() {
  let worm = await Worm.findOne().sort({ generation: -1 });
  if (!worm) {
    worm = await Worm.create({
      generation: 1,
      status: 'ALIVE',
      bornAt: new Date(),
      currentAction: 'waking up',
      treasury: { address: config.treasuryAddress },
    });
    await EventLog.create({
      generation: 1,
      kind: 'birth',
      text: 'Generation 1 woke up. The first warmth reached it and it began to listen.',
      tone: 'info',
    });
    console.log('[loop] fresh worm created at generation 1');
  }
  return worm;
}

async function runCycle() {
  if (running || halted) return;
  running = true;
  try {
    const worm = await Worm.findOne().sort({ generation: -1 });
    if (!worm) {
      running = false;
      return;
    }
    if (worm.status === 'DEAD') {
      halt();
      running = false;
      return;
    }

    const cycle = (worm.cycleCount || 0) + 1;
    const prevHealth = worm.treasuryHealth || 0;

    // 1) Read the real on-chain treasury.
    const read = await getTreasuryBalance(worm.treasury?.address || config.treasuryAddress);

    // If the read fails, keep the last known balance so a flaky RPC does not
    // falsely kill the worm.
    const balanceBnb = read.ok ? read.balanceBnb : worm.treasury?.balanceBnb || 0;

    // 2) Life model. Age feeds the birth-grace runway for a freshly hatched worm.
    const ageHours = (Date.now() - new Date(worm.bornAt).getTime()) / 36e5;
    const life = computeLifeModel(balanceBnb, ageHours);

    // 3) Metrics come from the real Avida population (latest epoch).
    const metrics = metricsFromEpoch(lastEpoch, worm.metrics);

    peakReadiness = Math.max(peakReadiness, metrics.readiness, worm.metrics?.readiness || 0);
    peakBreachProximity = Math.max(peakBreachProximity, metrics.breachProximity, worm.metrics?.breachProximity || 0);

    // 4) Narrated action label (display only).
    const action = actionFromHealth(life.treasuryHealth, life.status, worm.generation, cycle);

    // 5) Persist state.
    worm.cycleCount = cycle;
    worm.treasury = {
      address: worm.treasury?.address || config.treasuryAddress,
      balanceBnb,
      lastReadAt: new Date(),
      lastReadOk: read.ok,
    };
    worm.treasuryHealth = life.treasuryHealth;
    worm.burnRateBnbPerHour = life.burnRateBnbPerHour;
    worm.estimatedHoursRemaining = life.hoursRemaining;
    worm.estimatedCyclesRemaining = life.cyclesRemaining;
    worm.metrics = metrics;
    worm.currentAction = action;

    // 6) Status transitions.
    const wasStatus = worm.status;
    worm.status = life.status;

    // 7) Simulated event (non-death).
    const ev = maybeEvent(prevHealth, life.treasuryHealth, life.status, worm.generation, cycle);
    if (ev) {
      await EventLog.create({ generation: worm.generation, text: ev.text, tone: ev.tone });
    }
    if (wasStatus !== 'DYING' && worm.status === 'DYING') {
      await EventLog.create({
        generation: worm.generation,
        kind: 'status',
        text: 'The worm is dying. The warmth is almost gone.',
        tone: 'warning',
      });
    }
    if (wasStatus === 'DYING' && worm.status === 'ALIVE') {
      await EventLog.create({
        generation: worm.generation,
        kind: 'status',
        text: 'The warmth returned. The worm steadied and pulled back from the edge.',
        tone: 'rise',
      });
    }

    // 8) Diary note, on schedule or on a status change into DYING.
    const mood = moodFromHealth(life.treasuryHealth, life.status);
    const dueBySchedule = cycle % config.sim.diaryEveryCycles === 0;
    const dueByTransition = wasStatus !== worm.status;
    if (worm.status !== 'DEAD' && (dueBySchedule || dueByTransition)) {
      const note = await writeMementoNote({ mood, seedInt: config.sim.seed + worm.generation * 7 + cycle, stats: lastEpoch });
      await MementoNote.create({
        generation: worm.generation,
        text: note.text,
        mood,
        source: note.source,
        treasuryHealth: life.treasuryHealth,
      });
    }

    // 9) Cycle log.
    await CycleLog.create({
      generation: worm.generation,
      cycle,
      status: worm.status,
      treasuryBalanceBnb: balanceBnb,
      treasuryHealth: life.treasuryHealth,
      estimatedHoursRemaining: life.hoursRemaining,
      action,
      metrics,
    });

    // 10) Death handling.
    if (worm.status === 'DEAD') {
      await handleDeath(worm, balanceBnb, mood);
    }

    await worm.save();
  } catch (err) {
    console.error('[loop] cycle error:', err?.message || err);
  } finally {
    running = false;
  }
}

async function handleDeath(worm, balanceBnb, mood) {
  // Real death: one last epoch with zero food and kill probability 1, so the
  // Avida population genuinely goes to 0.
  if (avidaAvailable()) {
    while (epochRunning) await new Promise((r) => setTimeout(r, 500));
    epochRunning = true;
    try {
      const finalStats = await runEpoch(0, lastEpoch || {}, { dead: true });
      const lastDominant = lastEpoch?.dominant;
      lastEpoch = { ...finalStats, dominant: lastDominant || finalStats.dominant, finalPopulation: finalStats.population };
      await recordEpoch(worm.generation, lastEpoch);
      worm.metrics = metricsFromEpoch(lastEpoch, worm.metrics);
    } finally {
      epochRunning = false;
    }
  }
  worm.diedAt = new Date();
  worm.currentAction = 'gone quiet';

  // Final diary note.
  const finalNote = await writeMementoNote({
    mood: 'final',
    seedInt: config.sim.seed + worm.generation * 13,
  });
  await MementoNote.create({
    generation: worm.generation,
    text: finalNote.text,
    mood: 'final',
    source: finalNote.source,
    treasuryHealth: 0,
  });

  const lifespanHours = (worm.diedAt - new Date(worm.bornAt)) / 36e5;

  await Graveyard.create({
    generation: worm.generation,
    bornAt: worm.bornAt,
    diedAt: worm.diedAt,
    lifespanHours,
    lastBalanceBnb: balanceBnb,
    peakReadiness,
    peakBreachProximity,
    finalGenome: lastEpoch?.dominant?.genome || '',
    lineageDepth: lastEpoch?.peakDepth || 0,
    peakFitness: lastEpoch?.peakFitness || 0,
    finalGeneration: lastEpoch?.generation || 0,
    totalCopies: lastEpoch?.totalBirths || 0,
    finalNote: finalNote.text,
    epitaph: 'The warmth ran out. No copy came after.',
  });

  await EventLog.create({
    generation: worm.generation,
    kind: 'death',
    text: 'The treasury could no longer cover the burn. The worm died. No respawn.',
    tone: 'death',
  });

  console.log(`[loop] worm generation ${worm.generation} DIED. Loop halting permanently.`);
  halt();
}

function metricsFromEpoch(s, prev) {
  if (!s) {
    const p = prev?.toObject?.() || prev || {};
    return { readiness: 0, breachProximity: 0, replications: 0, infectedNodes: 0, pins: 0, signals: 0, ...p };
  }
  const labels = labelsFromStats(s);
  return {
    readiness: labels.readiness,
    breachProximity: labels.breachProximity,
    replications: s.totalBirths, // real cumulative divides
    infectedNodes: s.population, // real living organisms
    pins: s.epoch, // epochs survived
    signals: s.genotypes, // distinct living genotypes
  };
}

async function recordEpoch(generation, s) {
  await OrganismSnapshot.create({ generation, ...s, labels: labelsFromStats(s) });
}

// Restore the last known epoch stats (counters continue across restarts).
async function restoreEpoch() {
  const last = await OrganismSnapshot.findOne().sort({ createdAt: -1 }).lean();
  if (last) lastEpoch = last;
}

async function runEpochCycle() {
  if (epochRunning || halted) return;
  epochRunning = true;
  try {
    const worm = await Worm.findOne().sort({ generation: -1 });
    // Wait until the treasury has been read at least once.
    if (!worm || worm.status === 'DEAD' || !worm.cycleCount) return;
    const prev = lastEpoch;
    const s = await runEpoch(worm.treasuryHealth || 0, prev || {});
    if (!s.ok) {
      console.error(`[avida] epoch failed (exit ${s.exitCode}): ${s.tail.slice(-600)}`);
      return;
    }
    lastEpoch = s;
    await recordEpoch(worm.generation, s);
    const lbl = labelsFromStats(s);
    console.log(
      `[avida] epoch ${s.epoch} h=${s.biology.health.toFixed(2)} world=${s.biology.worldSide}^2 mut=${s.biology.copyMut.toFixed(4)} ` +
        `pop=${s.population} births=${s.births} gen=${s.generation.toFixed(2)} fit=${s.fitness.toFixed(4)} len=${s.dominant?.length || 0} ready=${lbl.readiness} breach=${lbl.breachProximity} (${s.seconds.toFixed(1)}s)`
    );
    if (prev && prev.population > 0) {
      const lost = prev.population - s.population;
      if (lost > prev.population * 0.2) {
        await EventLog.create({ generation: worm.generation, kind: 'organism', text: `${lost} organisms died this epoch as the food thinned.`, tone: 'fall' });
      } else if (s.population > prev.population * 1.2) {
        await EventLog.create({ generation: worm.generation, kind: 'organism', text: `The population grew to ${s.population}.`, tone: 'rise' });
      }
      if (lbl.hardestTask && lbl.hardestTask !== labelsFromStats(prev).hardestTask) {
        await EventLog.create({ generation: worm.generation, kind: 'organism', text: `An organism learned a new trick: ${lbl.hardestTask.toUpperCase()}.`, tone: 'rise' });
      }
    }
    if (s.population === 0) {
      await EventLog.create({ generation: worm.generation, kind: 'organism', text: 'The last organism died. The world is empty.', tone: 'death' });
    }
  } catch (err) {
    console.error('[avida] epoch error:', err?.message || err);
  } finally {
    epochRunning = false;
  }
}

export function latestEpoch() {
  return lastEpoch;
}

export async function startLoop() {
  if (timer) return;
  await restoreEpoch().catch(() => {});
  if (avidaAvailable()) {
    console.log(`[avida] engine at ${config.avida.bin}, epoch=${config.avida.epochSeconds}s, ${config.avida.updatesPerEpoch} updates/epoch`);
    setTimeout(runEpochCycle, 3000);
    epochTimer = setInterval(runEpochCycle, Math.max(5, config.avida.epochSeconds) * 1000);
  } else {
    console.error(`[avida] binary not found at ${config.avida.bin}. Build the Docker image (see README). Organism metrics stay at 0.`);
  }
  halted = false;
  const ms = Math.max(1000, config.sim.cycleSeconds * 1000);
  console.log(
    `[loop] starting. cycle=${config.sim.cycleSeconds}s, deepseek=${deepseekEnabled() ? 'live' : 'DORMANT (no key, using fallback notes)'}`
  );
  // Run one immediately so state is populated right away, then on interval.
  runCycle();
  timer = setInterval(runCycle, ms);
}

export function halt() {
  halted = true;
  if (epochTimer) {
    clearInterval(epochTimer);
    epochTimer = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function loopStatus() {
  return { halted, hasTimer: Boolean(timer) };
}
