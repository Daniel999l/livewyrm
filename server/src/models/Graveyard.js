import mongoose from 'mongoose';

// A permanent headstone for a dead generation. No respawn, no auto-launch.

const graveyardSchema = new mongoose.Schema(
  {
    generation: { type: Number, required: true, index: true },
    bornAt: { type: Date, required: true },
    diedAt: { type: Date, default: () => new Date() },
    lifespanHours: { type: Number, default: 0 },
    lastBalanceBnb: { type: Number, default: 0 },
    peakReadiness: { type: Number, default: 0 },
    peakBreachProximity: { type: Number, default: 0 },
    finalGenome: { type: String, default: '' },
    lineageDepth: { type: Number, default: 0 },
    peakFitness: { type: Number, default: 0 },
    finalGeneration: { type: Number, default: 0 },
    totalCopies: { type: Number, default: 0 },
    finalNote: { type: String, default: '' },
    epitaph: { type: String, default: '' },
  },
  { timestamps: false }
);

export const Graveyard = mongoose.model('Graveyard', graveyardSchema);
