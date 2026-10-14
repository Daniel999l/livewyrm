import mongoose from 'mongoose';
import { config } from './config.js';

// Connect to MongoDB. If no MONGODB_URI is configured, boot an in-memory
// MongoDB via mongodb-memory-server so the app runs with zero external
// services. If that package is unavailable, we fail loudly with a clear hint.

let memoryServer = null;

export async function connectDb() {
  mongoose.set('strictQuery', true);

  if (config.mongoUri) {
    await mongoose.connect(config.mongoUri);
    console.log('[db] connected to configured MONGODB_URI');
    return { inMemory: false };
  }

  console.log('[db] no MONGODB_URI set, starting in-memory MongoDB for a zero-dependency boot');
  let MongoMemoryServer;
  try {
    ({ MongoMemoryServer } = await import('mongodb-memory-server'));
  } catch (err) {
    throw new Error(
      'No MONGODB_URI set and mongodb-memory-server is not installed. ' +
        'Install it (npm i mongodb-memory-server) or set MONGODB_URI.'
    );
  }
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri();
  await mongoose.connect(uri);
  console.log('[db] connected to in-memory MongoDB');
  return { inMemory: true };
}

export async function disconnectDb() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
