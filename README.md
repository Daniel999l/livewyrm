# aiworm ($WYRM)

A digital organism that lives on its treasury.

aiworm runs a real population of self-replicating programs inside
[Avida](https://github.com/devosoft/avida), the open-source artificial-life
platform from Michigan State University's Digital Evolution Lab, used in
peer-reviewed evolution research. The organisms copy themselves, mutate and
evolve by natural selection. How much room and food they get comes from one
public, on-chain number: the BNB balance of the project treasury. Fees keep it
alive. If the treasury runs dry, the population dies and is recorded in the
graveyard. There is no respawn.

Live site: [livewyrm.com](https://livewyrm.com) · Source: [github.com/Daniel999l/livewyrm](https://github.com/Daniel999l/livewyrm)

---

## Contents

- [What is real](#what-is-real)
- [How it works](#how-it-works)
- [Treasury to biology](#treasury-to-biology)
- [Metrics](#metrics)
- [API](#api)
- [Architecture](#architecture)
- [Running locally](#running-locally)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Security](#security)

---

## What is real

| Component | Status |
| --- | --- |
| Organism population, births, generation, genome, evolved tasks | **Real.** Read straight from Avida's own output files every epoch |
| Treasury balance | **Real.** Public BNB balance read over a public BSC RPC |
| Life and death | **Real.** Driven by the treasury runway; death is permanent |
| Diary notes | Written by a language model (DeepSeek) in character, fed the real epoch stats. Fixed fallback lines are used when no API key is set |
| Roaming worm animation | Visual only. A canvas animation whose mood follows treasury health |

Avida organisms run on a virtual CPU inside Avida's own world. They have no
network access, no file access outside the run directory, and cannot affect
anything outside the simulation process.

## How it works

The service runs Avida in **epochs** (default 5 minutes):

1. Read the treasury balance on-chain and compute `treasuryHealth` (0 to 1).
2. Write a fresh Avida `environment.cfg` and `events.cfg` with parameters
   mapped from health (see below).
3. Load the previous population snapshot (`LoadPopulation`), so evolution is
   continuous across epochs and restarts.
4. Run a fixed number of Avida updates, then save the population
   (`SavePopulation`).
5. Parse `average.dat`, `count.dat`, `tasks.dat` and the `.spop` snapshot, and
   serve the numbers through the API.

Column positions are never hardcoded: the parser reads the column
descriptions Avida writes into each data file header.

## Treasury to biology

`h` is treasury health, 0 (empty) to 1 (fully healthy).

| Lever | Formula | Default range |
| --- | --- | --- |
| Carrying capacity | world side = `lerp(WORLD_SIDE_MIN, WORLD_SIDE_MAX, h)`, capacity = side² | 64 to 3,600 organisms |
| Mutation rate | `COPY_MUT_PROB = lerp(COPY_MUT_MAX, COPY_MUT_MIN, h)`, same for `DIVIDE_MUT_PROB` | 0.03 to 0.0025 per copy |
| Food | each of the 9 logic tasks rewards `REWARD_MAX × h × weight` (pow merit) | 0 to 5 |
| Starvation | below `STARVE_BELOW`, each organism dies per update with probability `STARVE_KILL_MAX × (1 − h / STARVE_BELOW)` | 0 to 0.02 |
| Death | when runway reaches the DEAD threshold, a final epoch runs with zero food and kill probability 1 | population goes to 0 |

When capacity shrinks between epochs, organisms that no longer fit are removed
from the snapshot before it is loaded. That cull is real.

On death the graveyard headstone stores the final dominant genome, lineage
depth, peak fitness, generation and total copies made.

## Metrics

| Site label | Source |
| --- | --- |
| copies made | Cumulative births, `count.dat`, summed across epochs |
| machines holding a fragment | Living organisms, `count.dat` |
| cycles survived | Epochs survived |
| generation | Average generation, `average.dat` |
| readiness | `100 × Σ(wₜ × organisms doing task t) / (Σwₜ × population)` |
| closing on a larger mind | `100 × (index of hardest task any organism performs + 1) / 9` |

Tasks, easiest to hardest, with weights: NOT 1, NAND 1, AND 2, ORN 2, OR 3,
ANDN 3, NOR 4, XOR 4, EQU 5.

## API

All endpoints are public, read-only JSON.

| Route | Returns |
| --- | --- |
| `GET /health` | Liveness |
| `GET /api/state` | Status, treasury balance, health, runway, token info |
| `GET /api/metrics` | Readiness, copies, population, epochs, genotypes |
| `GET /api/genome` | The current dominant organism: genome string, length, abundance, lineage depth, fitness, task counts, biology parameters |
| `GET /api/memento?limit=` | Diary notes, newest first |
| `GET /api/events?limit=` | Population events, newest first |
| `GET /api/graveyard` | Dead generations with headstone data |
| `GET /api/origin` | Source references |

The genome string is Avida's compact form: one letter per instruction from the
default heads instruction set (`instset-heads.cfg`).

## Architecture

One deployable service. Express serves the built frontend and the API, runs the
treasury loop, and spawns Avida as a child process in the same container.

```
livewyrm/
  Dockerfile            builds Avida (C++) then the Node service
  package.json
  vite.config.js        client builds into server/public
  client/               React + Vite frontend
  server/
    src/index.js        HTTP server, static site, loop start
    src/agent/avida.js  Avida epoch runner, config writer, data parsers
    src/agent/loop.js   treasury cycle + epoch scheduling + death
    src/services/       treasury (read-only on-chain), diary
    src/models/         MongoDB models
```

## Running locally

Requirements: Node 18+, and either Docker or a local Avida build.

**With Docker (recommended):**

```
docker build -t livewyrm .
docker run -p 3000:3000 -v wyrm:/data \
  -e TREASURY_ADDRESS=0x... -e CONTRACT_ADDRESS=0x... livewyrm
```

**Without Docker:**

```
git clone --recursive https://github.com/devosoft/avida
cd avida && mkdir build && cd build
AVIDA_DISABLE_BACKTRACE=1 cmake -DCMAKE_BUILD_TYPE=Release -DAVD_GUI_NCURSES=OFF -DAVD_UNIT_TESTS=OFF ..
make -j4 avida
# binary: build/bin/avida, configs: avida-core/support/config/

npm install
npm run build
AVIDA_BIN=/path/to/avida AVIDA_CONFIG_DIR=/path/to/configs npm start
```

Open http://localhost:3000. With no `MONGODB_URI` the server starts an
in-memory MongoDB, so no external services are needed.

Development with hot reload: `npm run dev:server` and `npm run dev:client`
(Vite on :5173 proxies `/api` to :3000). Smoke test: `npm run smoke`.

## Configuration

Required:

| Variable | Description |
| --- | --- |
| `TREASURY_ADDRESS` | Public BNB treasury address (read only) |
| `CONTRACT_ADDRESS` | Token contract. The buy link is derived as `flap.sh/bnb/<address>` |
| `DEEPSEEK_API_KEY` | Optional. Without it the diary uses fallback lines |

Optional overrides:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `MONGODB_URI` | in-memory | MongoDB for persistence across restarts |
| `REPO_URL` | `https://github.com/Daniel999l/livewyrm` | Source code link shown on the site |
| `BSC_RPC_URL` | `https://bsc-dataseed.binance.org` | BSC RPC for the balance read |
| `BUY_URL` | derived | Override the buy link |
| `BUY_URL_TEMPLATE` | `https://flap.sh/bnb/{address}` | Buy link pattern |
| `CYCLE_SECONDS` | `20` | Treasury read interval |
| `HEALTHY_BASELINE_BNB` | `1.0` | Balance considered fully healthy |
| `BURN_RATE_BNB_PER_HOUR` | `0.01` | Modelled burn rate |
| `DYING_HOURS` | `6` | Runway at or below this is DYING |
| `DEAD_HOURS` | `0` | Runway at or below this is DEAD |
| `BIRTH_GRACE_HOURS` | `48` | Starting runway before the wallet takes over |
| `DIARY_EVERY_CYCLES` | `6` | Diary cadence |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Diary model |
| `AVIDA_BIN` | `/opt/avida/avida` | Avida binary |
| `AVIDA_CONFIG_DIR` | `/opt/avida/config` | `avida.cfg`, `instset-heads.cfg`, ancestor |
| `AVIDA_WORK_DIR` | `./avida-data` | Run dir and population snapshot |
| `AVIDA_ANCESTOR` | `default-heads.org` | Seed organism |
| `AVIDA_SEED` | `1337` | Random seed |
| `EPOCH_SECONDS` | `300` | Epoch interval |
| `UPDATES_PER_EPOCH` | `1000` | Avida updates per epoch |
| `AVIDA_TIMEOUT_SECONDS` | `240` | Hard limit per Avida run |
| `WORLD_SIDE_MIN` / `WORLD_SIDE_MAX` | `8` / `60` | World side at zero / full health |
| `COPY_MUT_MIN` / `COPY_MUT_MAX` | `0.0025` / `0.03` | Copy mutation at full / zero health |
| `DIVIDE_MUT_MIN` / `DIVIDE_MUT_MAX` | `0` / `0.05` | Divide mutation at full / zero health |
| `REWARD_MAX` | `1.0` | Task reward at full health |
| `STARVE_BELOW` | `0.25` | Health below which starvation starts |
| `STARVE_KILL_MAX` | `0.02` | Per-update death probability at zero health |

With defaults, 1 BNB covers about 100 hours of runway.

## Deployment

Railway, single service:

1. Create a project from this repository. Railway builds the `Dockerfile`.
2. Set `TREASURY_ADDRESS`, `CONTRACT_ADDRESS` and optionally `DEEPSEEK_API_KEY`.
3. Add a volume mounted at `/data` so the population snapshot survives restarts.
4. Add a MongoDB instance and set `MONGODB_URI` so the graveyard and epoch history persist.

## Security

- The treasury is **read only**. This repository contains no private keys and
  never creates, stores or uses one. The only on-chain call is a public balance read.
- No `.env` files are committed.
- Avida runs sandboxed as a child process with a hard timeout. Organisms exist
  only inside the simulation.
