import mongoose from 'mongoose';

// A diary entry in the worm's voice ("Memento note"), written to future copies.

const mementoSchema = new mongoose.Schema(
  {
    generation: { type: Number, default: 1, index: true },
    text: { type: String, required: true },
    mood: {
      type: String,
      enum: ['confident', 'steady', 'uneasy', 'desperate', 'final'],
      default: 'steady',
    },
    // Where the text came from: the live model or the offline fallback bank.
    source: { type: String, enum: ['model', 'fallback'], default: 'fallback' },
    treasuryHealth: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: false }
);

mementoSchema.index({ createdAt: -1 });

export const MementoNote = mongoose.model('MementoNote', mementoSchema);
