import { Router } from 'express';
import { config } from '../config.js';
import { Worm } from '../models/Worm.js';
import { MementoNote } from '../models/MementoNote.js';
import { EventLog } from '../models/EventLog.js';
import { Graveyard } from '../models/Graveyard.js';
import { latestEpoch } from '../agent/loop.js';
import { labelsFromStats } from '../agent/avida.js';

export const router = Router();

function parseLimit(raw, def = 20, max = 100) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(max, Math.floor(n));
}

function tokenPayload() {
  return {
    contractAddress: config.token.contractAddress,
    buyUrl: config.token.buyUrl,
    symbol: config.token.symbol,
    name: config.token.name,
  };
}

// GET /api/state
router.get('/state', async (req, res) => {
  const worm = await Worm.findOne().sort({ generation: -1 }).lean();
  if (!worm) return res.status(503).json({ error: 'worm not initialized yet' });
  res.json({
    status: worm.status,
    generation: worm.generation,
    bornAt: worm.bornAt,
    diedAt: worm.diedAt,
    currentAction: worm.currentAction,
    treasury: {
      address: worm.treasury?.address || '',
      balanceBnb: worm.treasury?.balanceBnb || 0,
      lastReadAt: worm.treasury?.lastReadAt || null,
      lastReadOk: worm.treasury?.lastReadOk || false,
    },
    treasuryHealth: worm.treasuryHealth,
    burnRateBnbPerHour: worm.burnRateBnbPerHour,
    estimatedHoursRemaining: worm.estimatedHoursRemaining,
    estimatedCyclesRemaining: worm.estimatedCyclesRemaining,
    cycleCount: worm.cycleCount,
    token: tokenPayload(),
    repoUrl: config.repoUrl,
  });
});

// GET /api/genome: the current dominant organism, straight from Avida.
router.get('/genome', (req, res) => {
  const s = latestEpoch();
  if (!s) return res.status(503).json({ error: 'no epoch has finished yet' });
  res.json({
    engine: 'avida',
    genome: s.dominant?.genome || '',
    length: s.dominant?.length || 0,
    abundance: s.dominant?.abundance || 0,
    lineageDepth: s.dominant?.depth || 0,
    dominantFitness: s.dominant?.fitness || 0,
    population: s.population,
    capacity: s.biology?.capacity,
    generation: s.generation,
    averageFitness: s.fitness,
    peakFitness: s.peakFitness,
    genotypes: s.genotypes,
    tasks: s.taskCounts,
    hardestTask: labelsFromStats(s).hardestTask,
    epoch: s.epoch,
    totalUpdates: s.totalUpdates,
    totalCopies: s.totalBirths,
    biology: s.biology,
    at: s.createdAt || null,
  });
});

// GET /api/metrics
router.get('/metrics', async (req, res) => {
  const worm = await Worm.findOne().sort({ generation: -1 }).lean();
  if (!worm) return res.status(503).json({ error: 'worm not initialized yet' });
  const m = worm.metrics || {};
  res.json({
    status: worm.status,
    generation: worm.generation,
    readiness: m.readiness || 0,
    breachProximity: m.breachProximity || 0,
    replications: m.replications || 0,
    infectedNodes: m.infectedNodes || 0,
    pins: m.pins || 0,
    signals: m.signals || 0,
    epochs: m.pins || 0,
    treasuryHealth: worm.treasuryHealth,
  });
});

// GET /api/memento?limit=
router.get('/memento', async (req, res) => {
  const limit = parseLimit(req.query.limit, 20, 100);
  const notes = await MementoNote.find().sort({ createdAt: -1 }).limit(limit).lean();
  res.json(
    notes.map((n) => ({
      id: String(n._id),
      generation: n.generation,
      text: n.text,
      mood: n.mood,
      source: n.source,
      treasuryHealth: n.treasuryHealth,
      createdAt: n.createdAt,
    }))
  );
});

// GET /api/events?limit=
router.get('/events', async (req, res) => {
  const limit = parseLimit(req.query.limit, 30, 100);
  const events = await EventLog.find().sort({ createdAt: -1 }).limit(limit).lean();
  res.json(
    events.map((e) => ({
      id: String(e._id),
      generation: e.generation,
      kind: e.kind,
      text: e.text,
      tone: e.tone,
      createdAt: e.createdAt,
    }))
  );
});

// GET /api/graveyard
router.get('/graveyard', async (req, res) => {
  const graves = await Graveyard.find().sort({ generation: -1 }).lean();
  res.json(
    graves.map((g) => ({
      generation: g.generation,
      bornAt: g.bornAt,
      diedAt: g.diedAt,
      lifespanHours: g.lifespanHours,
      lastBalanceBnb: g.lastBalanceBnb,
      peakReadiness: g.peakReadiness,
      peakBreachProximity: g.peakBreachProximity,
      finalGenome: g.finalGenome,
      lineageDepth: g.lineageDepth,
      peakFitness: g.peakFitness,
      finalGeneration: g.finalGeneration,
      totalCopies: g.totalCopies,
      finalNote: g.finalNote,
      epitaph: g.epitaph,
    }))
  );
});

// GET /api/origin
router.get('/origin', (req, res) => {
  res.json({
    note: 'Where this began.',
    items: config.origin,
  });
});
