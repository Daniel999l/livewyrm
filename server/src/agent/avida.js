import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';

// Real organism engine. Runs the Avida artificial-life platform
// (github.com/devosoft/avida) as a child process inside this same service.
// Avida organisms are programs on a virtual CPU that copy themselves, mutate,
// and are shaped by selection. They live entirely inside Avida's own sandboxed
// world: no network, no files outside the run dir, nothing outside the process.
//
// Each epoch: write avida.cfg overrides + environment.cfg + events.cfg from
// treasury health, load the previous population snapshot (.spop), run a fixed
// number of updates, save the population, then parse the data files.

const A = () => config.avida;

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

/**
 * Treasury health (0..1) -> biology. All constants are env overrides.
 *   worldSide  = round(lerp(WORLD_SIDE_MIN, WORLD_SIDE_MAX, h))   carrying capacity = side^2
 *   copyMut    = lerp(COPY_MUT_MAX, COPY_MUT_MIN, h)               decay as health falls
 *   divideMut  = lerp(DIVIDE_MUT_MAX, DIVIDE_MUT_MIN, h)
 *   reward     = REWARD_MAX * h                                     task reward (food), 0 when starved
 *   killProb   = STARVE_KILL_MAX * (1 - h / STARVE_BELOW)  when h < STARVE_BELOW, else 0
 *   dead       => killProb = 1, reward = 0: the population really dies to 0
 */
export function biologyFromHealth(health, dead = false) {
  const c = A();
  const h = dead ? 0 : clamp01(health);
  const worldSide = Math.max(2, Math.round(lerp(c.worldSideMin, c.worldSideMax, h)));
  const starve = h < c.starveBelow ? c.starveKillMax * (1 - h / c.starveBelow) : 0;
  return {
    health: h,
    worldSide,
    capacity: worldSide * worldSide,
    copyMut: lerp(c.copyMutMax, c.copyMutMin, h),
    divideMut: lerp(c.divideMutMax, c.divideMutMin, h),
    reward: dead ? 0 : c.rewardMax * h,
    killProb: dead ? 1 : Math.min(1, Math.max(0, starve)),
    dead,
  };
}

// The nine classic Avida logic tasks, easiest to hardest.
const TASKS = ['not', 'nand', 'and', 'orn', 'or', 'andn', 'nor', 'xor', 'equ'];
const TASK_WEIGHT = [1, 1, 2, 2, 3, 3, 4, 4, 5];

function environmentCfg(bio) {
  // Reward scales with health. pow type: merit *= 2^value when the task is done.
  return TASKS.map((t, i) => {
    const v = (bio.reward * TASK_WEIGHT[i]).toFixed(4);
    return `REACTION ${t.toUpperCase()} ${t} process:value=${v}:type=pow requisite:max_count=1`;
  }).join('\n') + '\n';
}

function eventsCfg(bio, { loadFrom, updates }) {
  const lines = [];
  if (loadFrom) lines.push(`u begin LoadPopulation ${loadFrom}`);
  else lines.push(`u begin Inject ${A().ancestor}`);
  const every = Math.max(1, Math.floor(updates / 10));
  lines.push(`u 0:${every}:end PrintAverageData`);
  lines.push(`u 0:${every}:end PrintCountData`);
  lines.push(`u 0:${every}:end PrintTasksData`);
  lines.push(`u 0:${every}:end PrintDominantData`);
  if (bio.killProb > 0) lines.push(`u 1:1:end KillProb ${bio.killProb.toFixed(4)}`);
  lines.push(`u ${updates} SavePopulation`);
  lines.push(`u ${updates} PrintAverageData`);
  lines.push(`u ${updates} PrintCountData`);
  lines.push(`u ${updates} PrintTasksData`);
  lines.push(`u ${updates} PrintDominantData`);
  lines.push(`u ${updates} Exit`);
  return lines.join('\n') + '\n';
}

// Parse an Avida .dat file using its "#  N: description" header lines so we
// never hardcode column positions.
export function parseDat(file) {
  if (!fs.existsSync(file)) return { cols: [], rows: [] };
  const cols = [];
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^#\s*(\d+):\s*(.+)$/);
    if (m) {
      cols[Number(m[1]) - 1] = m[2].trim();
      continue;
    }
    if (!line.trim() || line.startsWith('#')) continue;
    rows.push(line.trim().split(/\s+/));
  }
  return { cols, rows };
}

function colIdx(cols, ...needles) {
  for (const n of needles) {
    const i = cols.findIndex((c) => c && c.toLowerCase().includes(n.toLowerCase()));
    if (i >= 0) return i;
  }
  return -1;
}

function lastVal(dat, ...needles) {
  const i = colIdx(dat.cols, ...needles);
  const row = dat.rows[dat.rows.length - 1];
  if (i < 0 || !row) return null;
  const v = Number(row[i]);
  return Number.isFinite(v) ? v : row[i];
}

function sumCol(dat, ...needles) {
  const i = colIdx(dat.cols, ...needles);
  if (i < 0) return 0;
  return dat.rows.reduce((s, r) => s + (Number(r[i]) || 0), 0);
}

// Parse a .spop population snapshot via its "#format" line.
export function parseSpop(file) {
  if (!fs.existsSync(file)) return [];
  let fields = null;
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('#format')) {
      fields = line.replace('#format', '').trim().split(/\s+/);
      continue;
    }
    if (!fields || !line.trim() || line.startsWith('#')) continue;
    const parts = line.trim().split(/\s+/);
    const rec = {};
    fields.forEach((f, i) => (rec[f] = parts[i]));
    out.push(rec);
  }
  return out;
}

// Fit a saved population into a (possibly smaller) world. Organisms beyond the
// new carrying capacity die (are dropped); survivors are packed into cells
// 0..n-1. Historic (dead) genotype rows are kept for lineage tracking.
export function fitSpop(src, dst, capacity) {
  const lines = fs.readFileSync(src, 'utf8').split('\n');
  let fields = null;
  let next = 0;
  const out = [];
  for (const line of lines) {
    if (line.startsWith('#format')) fields = line.replace('#format', '').trim().split(/\s+/);
    if (!fields || !line.trim() || line.startsWith('#')) {
      out.push(line);
      continue;
    }
    const parts = line.trim().split(/\s+/);
    const ci = fields.indexOf('cells');
    const gi = fields.indexOf('gest_offset');
    const ni = fields.indexOf('num_units');
    const cells = ci >= 0 && parts[ci] ? parts[ci].split(',').filter(Boolean) : [];
    if (!cells.length) {
      out.push(line);
      continue;
    }
    const offs = gi >= 0 && parts[gi] ? parts[gi].split(',') : [];
    const keepN = Math.max(0, Math.min(cells.length, capacity - next));
    if (keepN === 0) continue; // genotype wiped out by the cull
    const newCells = [];
    for (let k = 0; k < keepN; k++) newCells.push(String(next++));
    parts[ci] = newCells.join(',');
    if (gi >= 0) parts[gi] = offs.slice(0, keepN).join(',');
    if (ni >= 0) parts[ni] = String(keepN);
    out.push(parts.join(' '));
  }
  fs.writeFileSync(dst, out.join('\n'));
}

function runAvida(runDir, bio) {
  const c = A();
  const args = [
    '-c', path.join(runDir, 'avida.cfg'),
    '-s', String(c.seed),
    '-set', 'WORLD_X', String(bio.worldSide),
    '-set', 'WORLD_Y', String(bio.worldSide),
    '-set', 'COPY_MUT_PROB', bio.copyMut.toFixed(5),
    '-set', 'DIVIDE_MUT_PROB', bio.divideMut.toFixed(5),
    '-set', 'ENVIRONMENT_FILE', 'environment.cfg',
    '-set', 'EVENT_FILE', 'events.cfg',
    '-set', 'DATA_DIR', 'data',
  ];
  return new Promise((resolve) => {
    const child = spawn(c.bin, args, { cwd: runDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const keep = (d) => {
      tail = (tail + d.toString()).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const killer = setTimeout(() => child.kill('SIGKILL'), c.runTimeoutSeconds * 1000);
    child.on('error', (err) => {
      clearTimeout(killer);
      resolve({ ok: false, code: -1, tail: String(err?.message || err) });
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ ok: code === 0, code, tail });
    });
  });
}

function copyIfMissing(src, dst) {
  if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
}

export function avidaAvailable() {
  return fs.existsSync(A().bin);
}

/**
 * Run one epoch. Returns real stats parsed from Avida's own output.
 * state: { epoch, totalUpdates, totalBirths, peakFitness, ... } from the last epoch.
 */
export async function runEpoch(health, state = {}, { dead = false } = {}) {
  const c = A();
  const bio = biologyFromHealth(health, dead);
  const epoch = (state.epoch || 0) + 1;
  const root = path.resolve(c.workDir);
  const runDir = path.join(root, 'run');
  fs.mkdirSync(runDir, { recursive: true });

  for (const f of ['avida.cfg', 'instset-heads.cfg', c.ancestor]) {
    copyIfMissing(path.join(c.configDir, f), path.join(runDir, f));
  }

  const snapshot = path.join(root, 'latest.spop');
  const hasSnap = fs.existsSync(snapshot);
  if (hasSnap) fitSpop(snapshot, path.join(runDir, 'load.spop'), bio.capacity);

  fs.rmSync(path.join(runDir, 'data'), { recursive: true, force: true });
  fs.writeFileSync(path.join(runDir, 'environment.cfg'), environmentCfg(bio));
  fs.writeFileSync(
    path.join(runDir, 'events.cfg'),
    eventsCfg(bio, { loadFrom: hasSnap ? 'load.spop' : null, updates: c.updatesPerEpoch })
  );

  const started = Date.now();
  const run = await runAvida(runDir, bio);
  const dataDir = path.join(runDir, 'data');

  const avg = parseDat(path.join(dataDir, 'average.dat'));
  const cnt = parseDat(path.join(dataDir, 'count.dat'));
  const tasks = parseDat(path.join(dataDir, 'tasks.dat'));

  // Saved population (detail-<update>.spop).
  const spopName = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter((f) => f.endsWith('.spop')).sort().pop()
    : null;
  const orgs = spopName ? parseSpop(path.join(dataDir, spopName)) : [];
  const living = orgs.filter((o) => Number(o.num_units || o.num_cpus || 0) > 0);
  const population = living.reduce((s, o) => s + Number(o.num_units || o.num_cpus || 0), 0);
  const dom = living.slice().sort((a, b) => Number(b.num_units || b.num_cpus) - Number(a.num_units || a.num_cpus))[0];

  // Avida stops by itself when the last organism dies, before SavePopulation.
  // Data files present but no snapshot means the population went extinct.
  const extinct = !spopName && cnt.rows.length > 0;
  if (extinct) {
    run.ok = true;
    fs.rmSync(snapshot, { force: true });
  }

  if (spopName && run.ok) {
    if (population > 0) fs.copyFileSync(path.join(dataDir, spopName), snapshot);
    else fs.rmSync(snapshot, { force: true });
  }

  // Tasks: last row, count organisms doing each task.
  const taskRow = tasks.rows[tasks.rows.length - 1] || [];
  const taskCounts = {};
  TASKS.forEach((t) => {
    const i = colIdx(tasks.cols, t === 'not' ? 'Not' : t);
    const idx = tasks.cols.findIndex((col) => col && col.trim().toLowerCase() === t);
    const j = idx >= 0 ? idx : i;
    taskCounts[t] = j >= 0 ? Number(taskRow[j]) || 0 : 0;
  });

  const births = sumCol(cnt, 'births');
  const deaths = sumCol(cnt, 'deaths');
  const fitness = Number(lastVal(avg, 'fitness')) || 0;
  const generation = Number(lastVal(avg, 'generation')) || 0;
  const avgLength = Number(lastVal(avg, 'copied size')) || 0;
  const countPop = Number(lastVal(cnt, 'number of organisms', 'organisms')) ;

  const stats = {
    ok: run.ok,
    exitCode: run.code,
    epoch,
    seconds: (Date.now() - started) / 1000,
    biology: bio,
    loadedSnapshot: hasSnap,
    updates: c.updatesPerEpoch,
    totalUpdates: (state.totalUpdates || 0) + (run.ok ? c.updatesPerEpoch : 0),
    population: extinct ? 0 : Number.isFinite(countPop) ? countPop : population,
    extinct,
    births,
    deaths,
    totalBirths: (state.totalBirths || 0) + births,
    generation,
    fitness,
    peakFitness: Math.max(state.peakFitness || 0, fitness),
    avgLength,
    genotypes: Number(lastVal(cnt, 'different genotypes', 'genotypes')) || 0,
    taskCounts,
    dominant: dom
      ? {
          genome: dom.sequence || '',
          length: (dom.sequence || '').length,
          abundance: Number(dom.num_units || dom.num_cpus) || 0,
          depth: Number(dom.depth) || 0,
          fitness: Number(dom.fitness) || 0,
          genBorn: Number(dom.gen_born) || 0,
          id: dom.id,
        }
      : null,
    tail: run.ok ? '' : run.tail,
  };
  stats.peakDepth = Math.max(state.peakDepth || 0, stats.dominant?.depth || 0);
  return stats;
}

/**
 * Real-metric -> existing label formulas.
 *   readiness       = 100 * sum_t(w_t * orgs_doing_t) / (sum_t w_t * population)
 *                     weighted fraction of the population performing logic tasks
 *   breachProximity = 100 * (hardest task index reached + 1) / 9
 *                     how far up the 9-task ladder (NOT .. EQU) any organism has climbed
 */
export function labelsFromStats(s) {
  const pop = s.population || 0;
  let num = 0;
  let den = 0;
  let hardest = -1;
  TASKS.forEach((t, i) => {
    const n = s.taskCounts?.[t] || 0;
    num += TASK_WEIGHT[i] * Math.min(n, pop);
    den += TASK_WEIGHT[i] * pop;
    if (n > 0) hardest = i;
  });
  return {
    readiness: den > 0 ? Math.round((1000 * num) / den) / 10 : 0,
    breachProximity: Math.round((1000 * (hardest + 1)) / TASKS.length) / 10,
    hardestTask: hardest >= 0 ? TASKS[hardest] : null,
  };
}
