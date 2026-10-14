import mongoose from 'mongoose';

// Simulated narrative events ONLY. These are story beats produced by the sim,
// never records of anything real happening in the world.

const eventSchema = new mongoose.Schema(
  {
    generation: { type: Number, default: 1, index: true },
    kind: { type: String, default: 'narrative' },
    text: { type: String, required: true },
    // Optional severity tint for the frontend (info / rise / fall / warning).
    tone: {
      type: String,
      enum: ['info', 'rise', 'fall', 'warning', 'death'],
      default: 'info',
    },
    createdAt: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: false }
);

eventSchema.index({ createdAt: -1 });

export const EventLog = mongoose.model('EventLog', eventSchema);
