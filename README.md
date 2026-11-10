# Grand Prompt

A motorsport benchmark for LLMs. Each model writes a driving program once, practising on a few
circuits; then every program drives the same open-wheel car over one flying lap of every circuit,
the ones it never saw included, in a deterministic simulator, and the laps are replayed together
in 3D.

## Setup

Node 22 or later and pnpm (`corepack enable`), then:

```shell
pnpm install
pnpm bench --help
```

Building drivers also needs [bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`) and
the coding CLIs of the models you list, installed and logged in: `claude`, `codex`, `gemini`.

## 1. Tracks

```shell
pnpm bench tracks            # the circuits: monaco, silverstone, portimao, barcelona, proto-ring
pnpm bench tracks import     # rebuild them from the raw extracts in tracks/sources/
```

Monaco and Portimão come from OpenStreetMap (ODbL), Silverstone and Barcelona from the TUMFTM
racetrack database (LGPL); see [tracks/sources/README.md](tracks/sources/README.md). To add a
circuit, put its extract in `tracks/sources/` and an entry in `TRACK_SOURCES`
(`packages/cli/src/tracks.ts`), then import. `proto-ring` is a handmade test circuit.

## 2. Build drivers

The models are listed in [models.json](models.json), by CLI:

```json
{ "effort": "medium", "claude": [{ "id": "claude-opus-5-5", "name": "Claude Opus 5.5" }], "codex": [], "gemini": [] }
```

```shell
pnpm bench build gp-2 --check          # sandbox, practice service and CLIs, no model run
pnpm bench build gp-2                  # every model in parallel, with a live view
pnpm bench build gp-2 --only codex     # one provider, or a model id
```

Each model's CLI runs unattended in its own bubblewrap sandbox that sees only its workspace: the
driver spec, the practice circuits (Monaco, Silverstone, Portimão), a working but slow baseline
driver and a practice client. It has 30 minutes, which its prompt states, and 10 practice laps
shared across the circuits, timed by a local service outside the sandbox. If it is cut off, its
newest driver that completed a clean practice lap is submitted.

Output: `drivers/gp-2/<model>/driver.js` and `manifest.json` (tokens, cost, wall time, practice
laps used), and `drivers/gp-2/event.json` (its name and seed). Build logs
go to `results/builds/gp-2/<model>/build/`. See `pnpm bench --help` for `--timeout`, `--budget`,
`--effort`, `--jobs` and the circuits.

To work on a driver by hand: `pnpm bench validate <driver.js>` and
`pnpm bench practice <driver.js> --track monaco` (telemetry, summary and a replay in
`results/practice/`).

## 3. Race

```shell
pnpm bench race gp-2                   # every circuit -> results/races/gp-2-<track>/
pnpm bench race gp-2 --track monaco    # one circuit
pnpm bench reproduce gp-2              # re-run every race and check every hash
```

Each race folder holds `replay.json.gz`, `results.json`, `summary.txt` and `event-results.json`
(the table with each model's build manifest).

A session is the same everywhere, practice included: a 3 s run-up placed by the sim, every car
crossing the line together at the same speed, then one timed lap. Leaving the track deletes the
lap. Results are bit-for-bit reproducible from the drivers, the circuit and the seed.

## 4. Watch

```shell
make dev      # http://localhost:5173/
```

The home page lists every race in `results/races/`, `/races/<id>` plays one (`/races/gp-2-monaco`)
and `/drivers` lists the models that built the drivers, with their standings: 10-8-6-5-4-3-2-1
points in every race for a valid lap. Results stay hidden until you show them. Press `?` for the
keyboard shortcuts. Below 600 px wide it switches to a phone layout.

## Make

`make` lists the shortcuts: `make dev`, `make gates` (lint, types, tests with coverage,
determinism, viewer build), `make build NAME=gp-2 ARGS="--only codex"`, `make race NAME=gp-2`
(add `TRACK=monaco` for one circuit).
