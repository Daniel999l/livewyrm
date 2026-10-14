import mongoose from 'mongoose';

// One record per simulation cycle. A compact audit trail of the sim.

const cycleLogSchema = new mongoose.Schema(
  {
    generation: { type: Number, default: 1, index: true },
    cycle: { type: Number, default: 0 },
    status: { type: String, default: 'ALIVE' },
    treasuryBalanceBnb: { type: Number, default: 0 },
    treasuryHealth: { type: Number, default: 0 },
    estimatedHoursRemaining: { type: Number, default: 0 },
    action: { type: String, default: '' },
    metrics: { type: Object, default: {} },
    createdAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: false }
);

cycleLogSchema.index({ createdAt: -1 });

export const CycleLog = mongoose.model('CycleLog', cycleLogSchema);
