import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { config, deepseekEnabled } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { router } from './api/routes.js';
import { ensureWorm, startLoop, halt } from './agent/loop.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built frontend lives in server/public (vite build output). src is one level in.
const publicDir = path.resolve(__dirname, '..', 'public');

async function main() {
  const { inMemory } = await connectDb();

  // Fresh DB comes up with one ALIVE worm at generation 1.
  await ensureWorm();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ ok: true, inMemoryDb: inMemory, deepseek: deepseekEnabled() ? 'live' : 'dormant' });
  });

  app.use('/api', router);

  // Start the sim/agent loop in the SAME process as the API (single service).
  await startLoop();

  // Serve the built frontend (if it has been built) from the same process.
  const hasBuild = fs.existsSync(path.join(publicDir, 'index.html'));
  if (hasBuild) {
    app.use(express.static(publicDir));
    // SPA catch-all: any non-API, non-health route returns index.html.
    app.get(/^\/(?!api\/|health$).*/, (req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  } else {
    console.log('[http] No built frontend found in server/public. Run "npm run build" first. API still serves.');
  }

  const server = app.listen(config.port, () => {
    console.log(`[http] API listening on :${config.port}`);
    if (!deepseekEnabled()) {
      console.log('[http] DEEPSEEK_API_KEY is not set. Diary is in dormant mode (fallback notes). Waiting for a key.');
    }
  });

  const shutdown = async (sig) => {
    console.log(`[http] ${sig} received, shutting down`);
    halt();
    server.close();
    await disconnectDb().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal] failed to start:', err);
  process.exit(1);
});
