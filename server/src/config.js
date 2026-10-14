// Central configuration. Everything is sourced from environment variables.
// Values WITH a default live here (and are documented as overrides in the README).
// Values WITHOUT a default (secrets / deployment-specific) live in .env.example.
//
// We never read a .env file ourselves. The host (Railway, local shell, etc.)
// is responsible for putting these into process.env.

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw;
}

export const config = {
  // --- Server ---
  port: num('PORT', 3000),

  // --- Database ---
  // If MONGODB_URI is absent, the app boots an in-memory MongoDB so it runs
  // with zero external services.
  mongoUri: str('MONGODB_URI', ''),

  // --- On-chain treasury (READ ONLY) ---
  // The public BNB address that holds the worm's creator-fee treasury.
  treasuryAddress: str('TREASURY_ADDRESS', ''),
  // Public BSC RPC endpoint. Default is a well-known public node.
  bscRpcUrl: str('BSC_RPC_URL', 'https://bsc-dataseed.binance.org'),

  // --- Token layer (required for the frontend to show contract + buy button) ---
  // buyUrl is DERIVED from the contract address by default: flap.sh/bnb/<CA>.
  // Override the whole link with BUY_URL, or change the pattern with
  // BUY_URL_TEMPLATE (use {address} where the contract goes).
  token: (() => {
    const contractAddress = str('CONTRACT_ADDRESS', '');
    const template = str('BUY_URL_TEMPLATE', 'https://flap.sh/bnb/{address}');
    const derived = contractAddress ? template.replace('{address}', contractAddress) : '';
    return {
      contractAddress,
      buyUrl: str('BUY_URL', '') || derived,
      symbol: 'WYRM',
      name: 'aiworm',
    };
  })(),

  // --- DeepSeek (optional; absent key => dormant diary mode) ---
  deepseek: {
    apiKey: str('DEEPSEEK_API_KEY', ''),
    model: str('DEEPSEEK_MODEL', 'deepseek-chat'),
    baseUrl: str('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
  },

  // --- Simulation / life model ---
  sim: {
    // How often the agent loop ticks, in seconds.
    cycleSeconds: num('CYCLE_SECONDS', 20),

    // Treasury balance (in BNB) considered "fully healthy". Health saturates here.
    healthyBaselineBnb: num('HEALTHY_BASELINE_BNB', 1.0),

    // BNB consumed per hour of life. This is the narrative "metabolism".
    burnRateBnbPerHour: num('BURN_RATE_BNB_PER_HOUR', 0.01),

    // Status thresholds expressed in HOURS of life remaining.
    // At or below dyingHours the worm is DYING. At or below deadHours it DIES.
    dyingHours: num('DYING_HOURS', 6),
    deadHours: num('DEAD_HOURS', 0),

    // A freshly hatched worm carries innate runway (its "birth energy") that
    // decays over this many hours, so a brand new launch is ALIVE while the
    // wallet is still cold and fees have not arrived yet. After this window,
    // survival depends entirely on the wallet. Set to 0 to disable.
    birthGraceHours: num('BIRTH_GRACE_HOURS', 48),

    // Write a diary note roughly every N cycles (plus mood-driven triggers).
    diaryEveryCycles: num('DIARY_EVERY_CYCLES', 6),

    // Deterministic seed so the simulation looks continuous across restarts.
    seed: num('SIM_SEED', 1337),
  },

  // --- Open source link (blank-safe: nothing is rendered if unset) ---
  repoUrl: str('REPO_URL', 'https://github.com/Daniel999l/livewyrm'),

  // --- Real organism engine (Avida, run as a child process) ---
  // Treasury health maps to biology; see biologyFromHealth in agent/avida.js.
  avida: {
    bin: str('AVIDA_BIN', '/opt/avida/avida'),
    configDir: str('AVIDA_CONFIG_DIR', '/opt/avida/config'),
    workDir: str('AVIDA_WORK_DIR', './avida-data'),
    ancestor: str('AVIDA_ANCESTOR', 'default-heads.org'),
    epochSeconds: num('EPOCH_SECONDS', 300),
    updatesPerEpoch: num('UPDATES_PER_EPOCH', 1000),
    runTimeoutSeconds: num('AVIDA_TIMEOUT_SECONDS', 240),
    seed: num('AVIDA_SEED', 1337),
    worldSideMin: num('WORLD_SIDE_MIN', 8),
    worldSideMax: num('WORLD_SIDE_MAX', 60),
    copyMutMin: num('COPY_MUT_MIN', 0.0025),
    copyMutMax: num('COPY_MUT_MAX', 0.03),
    divideMutMin: num('DIVIDE_MUT_MIN', 0.0),
    divideMutMax: num('DIVIDE_MUT_MAX', 0.05),
    rewardMax: num('REWARD_MAX', 1.0),
    starveBelow: num('STARVE_BELOW', 0.25),
    starveKillMax: num('STARVE_KILL_MAX', 0.02),
  },

  // --- Origin source items (placeholders the owner replaces) ---
  // Config-driven so the frontend can render an "origin" panel.
  // Real references, each URL verified to load.
  origin: [
    {
      title: 'The post that started it',
      url: 'https://x.com/ns123abc/status/2109769030416425222',
      outlet: 'X / @ns123abc',
    },
    {
      title: 'AI models may be capable of self-replicating without access to a datacenter',
      url: 'https://www.anthropic.com/research/self-replicating-ai',
      outlet: 'Anthropic',
    },
    {
      title: '"AI worms" may soon be able to self-replicate and infect smart devices, Anthropic says',
      url: 'https://www.cbsnews.com/news/ai-worms-smart-devices-anthropic/',
      outlet: 'CBS News',
    },
    {
      title: 'Anthropic warns AI will soon self-replicate and spread beyond data centres',
      url: 'https://www.euronews.com/2026/10/13/anthropic-warns-ai-will-soon-self-replicate-and-spread-beyond-data-centres',
      outlet: 'Euronews',
    },
    {
      title: 'Small AI Models Could Soon Self-Replicate on IoT Devices, Anthropic Warns',
      url: 'https://www.securityweek.com/small-ai-models-may-soon-be-able-to-self-replicate-on-iot-devices-anthropic-warns/',
      outlet: 'SecurityWeek',
    },
  ],
};

export function deepseekEnabled() {
  return Boolean(config.deepseek.apiKey);
}
