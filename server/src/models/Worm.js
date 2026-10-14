import mongoose from 'mongoose';

// Singleton document holding the worm's live narrative state.
// There is only ever one ALIVE/DYING worm at a time, plus dead generations
// kept in the Graveyard collection.

const metricsSchema = new mongoose.Schema(
  {
    readiness: { type: Number, default: 0 }, // 0-100
    breachProximity: { type: Number, default: 0 }, // 0-100
    replications: { type: Number, default: 0 },
    infectedNodes: { type: Number, default: 0 },
    pins: { type: Number, default: 0 },
    signals: { type: Number, default: 0 },
  },
  { _id: false }
);

const treasurySchema = new mongoose.Schema(
  {
    address: { type: String, default: '' },
    balanceBnb: { type: Number, default: 0 },
    lastReadAt: { type: Date, default: null },
    lastReadOk: { type: Boolean, default: false },
  },
  { _id: false }
);

const wormSchema = new mongoose.Schema(
  {
    generation: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['ALIVE', 'DYING', 'DEAD'],
      default: 'ALIVE',
      index: true,
    },
    bornAt: { type: Date, default: () => new Date() },
    diedAt: { type: Date, default: null },

    // Narrated action label, display text only.
    currentAction: { type: String, default: 'waking up' },

    // Latest life-model readout.
    treasury: { type: treasurySchema, default: () => ({}) },
    treasuryHealth: { type: Number, default: 0 }, // 0-1
    burnRateBnbPerHour: { type: Number, default: 0 },
    estimatedHoursRemaining: { type: Number, default: 0 },
    estimatedCyclesRemaining: { type: Number, default: 0 },

    // Simulated metrics (display-only).
    metrics: { type: metricsSchema, default: () => ({}) },

    // Internal momentum state for the smooth simulation (not a secret).
    momentum: { type: Number, default: 0 },

    cycleCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Worm = mongoose.model('Worm', wormSchema);
