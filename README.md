<p align="center">
  <a href="https://llm-racing.crty.dev/"><img src=".github/assets/banner.png" alt="LLM Racing: which AI is the best driver? The stopwatch never lies. The leaders at Silverstone, 9 seconds into their lap" width="100%"></a>
</p>

<p align="center">
  <a href="https://llm-racing.crty.dev/"><img src=".github/assets/watch-the-races.png" alt="Watch the races at llm-racing.crty.dev" width="420"></a>
</p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#run-it-yourself">Run it yourself</a>
</p>

https://github.com/user-attachments/assets/7d9faa92-9def-4c08-945d-42c3fe8cbe7b

<p align="center"><sub>Barcelona, the first 20 seconds. Every car is driven by code an AI wrote; each runs alone and the laps are replayed together.</sub></p>

# LLM Racing

**A benchmark where LLMs write the code that drives a race car.**

Each model gets 30 minutes to write a driver: a JavaScript program that reads the car's
telemetry and answers with throttle, brake and steering. It has 10 practice laps to test the
driver and improve it.

Then every program drives the same car for one flying lap on every circuit, including some it
never practised on, and the laps are replayed side by side in 3D in a web app:
**[llm-racing.crty.dev](https://llm-racing.crty.dev/)**.

The model never touches the controls during the race.

## How it works

1. **Build.** Each model runs in its own coding CLI (`claude`, `codex`, Antigravity's `agy`), unattended, in a
   [bubblewrap](https://github.com/containers/bubblewrap) sandbox that sees only its workspace. It
   can practise on Monaco, Silverstone and Portimão through a local timing service; it gets back a
   lap time, a telemetry CSV and a text summary. When the time is up, its newest driver that
   completed a clean lap is submitted.
2. **Race.** Every driver runs in a QuickJS sandbox with the same compute budget, on Monaco,
   Silverstone, Portimão, Barcelona and a handmade test circuit. Each car runs alone (ghost mode):
   a flying start, one timed lap, and any moment off track deletes the lap. Hitting a barrier fast
   is a crash.
3. **Watch.** The viewer plays the recorded laps together, with a timing tower, telemetry and a
   head-to-head analysis. It runs no physics: what you see is exactly what was timed.

### The rules that keep it fair

- **Deterministic.** Fixed timestep, seeded randomness, no wall clock. A result is a pure function
  of the sim version, circuit, car, driver code and seed, and `bench reproduce` re-runs every race
  and checks it bit for bit.
- **Same information for everyone.** Drivers see the track geometry and the public car parameters
  in [`ddk/`](ddk/) (the "driver development kit"). The tyre, aero and brake constants stay hidden;
  they have to be learned from practice.
- **Same session, same budget.** Same prompt, time limit, practice laps and per-step compute for
  every model.
- **No exploits.** Sector checkpoints stop cutting and driving backwards, track limits are
  enforced, and full lock at speed spins the car as it should.

The simulator is a bicycle model with Pacejka tyres, load transfer and aero, written in TypeScript
with no rendering dependency. Real circuits come from OpenStreetMap and the TUMFTM racetrack
database (see [tracks/sources](tracks/sources/README.md)).

## Status

The current results come from `gp-1`: nine Claude and GPT models, each built once at medium
effort. Gemini models are next, built through the Antigravity CLI. Further out:
wheel-to-wheel racing, with a shared track, collisions and a new driver API.

## Run it yourself

Node 22 or later and pnpm (`corepack enable`), then:

```shell
pnpm install
pnpm bench --help
make dev                                      # the viewer on http://localhost:5173/
```

Building drivers also needs bubblewrap (`bwrap`) and the coding CLIs of the models you list,
installed and logged in.

### 1. Tracks

```shell
pnpm bench tracks            # the circuits: monaco, silverstone, portimao, barcelona, proto-ring
pnpm bench tracks import     # rebuild them from the raw extracts in tracks/sources/
```

Monaco and Portimão come from OpenStreetMap (ODbL), Silverstone and Barcelona from the TUMFTM
racetrack database (LGPL); see [tracks/sources/README.md](tracks/sources/README.md). To add a
circuit, put its extract in `tracks/sources/` and an entry in `TRACK_SOURCES`
(`packages/cli/src/tracks.ts`), then import. `proto-ring` is a handmade test circuit.

### 2. Build drivers

The models are listed in [models.json](models.json), the roster: everything that identifies a
model, for the build and for the viewer alike. Each provider names the CLI that builds its models
and its car body paint; each model has its name, a three-letter code and an entry colour of its own
(the chip, trail and livery stripe), the same in every event:

```json
{
  "effort": "medium",
  "providers": { "anthropic": { "label": "Anthropic", "cli": "claude", "body": "clay" } },
  "models": [
    { "id": "claude-opus-5-5", "name": "Claude Opus 5.5", "code": "OPU", "provider": "anthropic", "color": "lime" }
  ]
}
```

Colours are names from the design tokens (`packages/ui/tokens.json`): `color` is the `label` of an
`entry-*` token, unique in the roster, and `body` (on a provider, or on a model to override it) a
`body-*` token without its prefix. A model may set its own `effort`. A car that is not on the
roster still races, with a code from its name and a colour no roster model owns.

```shell
pnpm bench build gp-2 --check          # sandbox, practice service and CLIs, no model run
pnpm bench build gp-2                  # every model in parallel, with a live view
pnpm bench build gp-2 --only codex     # a provider, a CLI or a model id
```

The workspace each model sees holds the driver spec, the practice circuits, the baseline driver
and a practice client. Its 30 minutes are stated in its prompt, and its 10 practice laps are shared
across the circuits.

Output: `drivers/gp-2/<model>/driver.js` and `manifest.json` (tokens, cost, wall time, practice
laps used), and `drivers/gp-2/event.json` (its name and seed). Build logs go to
`results/builds/gp-2/<model>/build/`. See `pnpm bench --help` for `--timeout`, `--budget`,
`--effort`, `--jobs` and the circuits.

To work on a driver by hand: `pnpm bench validate <driver.js>` and
`pnpm bench practice <driver.js> --track monaco` (telemetry, summary and a replay in
`results/practice/`).

### 3. Race

```shell
pnpm bench race gp-2                   # every circuit -> results/races/gp-2-<track>/
pnpm bench race gp-2 --track monaco    # one circuit
pnpm bench reproduce gp-2              # re-run every race and check every hash
```

Each race folder holds `replay.json.gz`, `results.json`, `summary.txt` and `event-results.json`
(the table with each model's build manifest).

A session is the same everywhere, practice included: a 3 s run-up placed by the sim, every car
crossing the line together at the same speed, then one timed lap.

### 4. Watch

```shell
make dev      # http://localhost:5173/
```

The home page lists every race in `results/races/`, `/races/<id>` plays one (`/races/gp-2-monaco`)
and `/drivers` lists the models that built the drivers, with their standings: 10-8-6-5-4-3-2-1
points in every race for a valid lap. Results stay hidden until you show them. Press `?` for the
keyboard shortcuts. Below 600 px wide it switches to a phone layout.

### Make

`make` lists the shortcuts: `make dev`, `make gates` (lint, types, tests with coverage,
determinism, viewer build), `make build NAME=gp-2 ARGS="--only codex"`, `make race NAME=gp-2`
(add `TRACK=monaco` for one circuit).

## License

[MIT](LICENSE). Circuit data keeps its own licence (ODbL, LGPL), see
[tracks/sources](tracks/sources/README.md).

---

Made by [David Courtey](https://crty.dev).
