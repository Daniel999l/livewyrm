// Boots the server in-process (in-memory DB, no DEEPSEEK key), waits for the
// first sim cycle to populate state, then hits every endpoint and prints the
// JSON. Exits non-zero if anything fails to return valid JSON.

import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';

const PORT = process.env.SMOKE_PORT || '4123';
const BASE = `http://127.0.0.1:${PORT}`;

const env = {
  ...process.env,
  PORT,
  CYCLE_SECONDS: '2',
  DIARY_EVERY_CYCLES: '1',
  // Intentionally no MONGODB_URI (in-memory), no DEEPSEEK_API_KEY (dormant).
  CONTRACT_ADDRESS: '0x000000000000000000000000000000000000dEaD',
  BUY_URL: 'https://flap.sh/token/0x000000000000000000000000000000000000dEaD',
  TREASURY_ADDRESS: '0x0000000000000000000000000000000000000000',
};

const child = spawn('node', ['src/index.js'], {
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
});

const endpoints = [
  '/health',
  '/api/state',
  '/api/metrics',
  '/api/memento?limit=5',
  '/api/events?limit=5',
  '/api/graveyard',
  '/api/origin',
  '/api/genome',
];

async function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('server did not become healthy in time');
}

async function run() {
  await waitForHealth();
  // Let a couple of sim cycles run so metrics + a diary note exist.
  await sleep(3000);

  let failures = 0;
  for (const ep of endpoints) {
    try {
      const r = await fetch(`${BASE}${ep}`);
      const text = await r.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        failures += 1;
        console.log(`\n=== ${ep} === HTTP ${r.status} NON-JSON:\n${text.slice(0, 300)}`);
        continue;
      }
      console.log(`\n=== ${ep} === HTTP ${r.status}`);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (err) {
      failures += 1;
      console.log(`\n=== ${ep} === REQUEST FAILED: ${err.message}`);
    }
  }
  return failures;
}

run()
  .then((failures) => {
    child.kill('SIGTERM');
    if (failures > 0) {
      console.error(`\nSMOKE TEST FAILED: ${failures} endpoint(s) did not return valid JSON`);
      process.exit(1);
    }
    console.log('\nSMOKE TEST PASSED: every endpoint returned valid JSON');
    process.exit(0);
  })
  .catch((err) => {
    console.error('SMOKE TEST ERROR:', err);
    child.kill('SIGTERM');
    process.exit(1);
  });
