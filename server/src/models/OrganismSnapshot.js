import mongoose from 'mongoose';

// Metadata for each real Avida epoch: what the population actually did.
// The population itself lives in the .spop file in AVIDA_WORK_DIR.

const organismSnapshotSchema = new mongoose.Schema(
  {
    generation: { type: Number, default: 1, index: true },
    createdAt: { type: Date, default: () => new Date(), index: true },
  },
  { strict: false, timestamps: false }
);

export const OrganismSnapshot = mongoose.model('OrganismSnapshot', organismSnapshotSchema);
