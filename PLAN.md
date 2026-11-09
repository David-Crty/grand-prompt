# F1 LLM Bench: Project Plan

> **Status (2026-11-09):** phases 0 to 2 are implemented. Phase 3 tooling is in place (sandbox, DDK,
> house driver, manifests, leaderboard, one-shot runner, agentic practice service), but the first
> benchmark event with real models has not been run yet. Deviations are recorded in `docs/DECISIONS.md`.

> Working title. A motorsport benchmark where each LLM writes a driving program, then all programs race on the same circuit in a deterministic simulator. Results are rendered as a 3D replay worth sharing.

---

## 0. How to use this plan

This document gives **direction, not a frozen spec**. It is written for the coding agent that will implement the project.

- **Firm**: the goals (section 1), the design principles (section 3) and the acceptance criteria of each phase (section 12). Change these only with an explicit decision from the project owner.
- **Initial, adaptable**: interfaces, file formats, parameter values, folder layout and library choices. They are starting points. Change them when the implementation shows a better path.
- **Record every significant deviation** in `docs/DECISIONS.md` (one short entry per decision: context, choice, consequences). Update this plan when a section no longer matches reality.
- **Build vertical slices.** A crude end-to-end loop (track → sim → driver → replay → viewer) beats a polished component that nothing uses yet.
- **Ask the owner** before freezing the public driver API for a benchmark season (section 6.5) or before anything that invalidates past results.

---

## 1. Vision and goals

**What we are building**

1. **The engine**: a headless, deterministic racing simulator with an open-wheel race car model, plus a 3D viewer that replays races.
2. **The Driver Development Kit (DDK)**: the documentation, types, prompts and tools an LLM uses to write a driver program, and the harness that runs the benchmark.

**Goals for the prototype**

- A car model realistic enough that braking points, racing line and corner speed visibly matter.
- Any LLM can produce a working driver from the DDK alone.
- Several drivers on one circuit, compared on lap time, shown together in a pleasant 3D replay.
- Every result reproducible from its manifest.

**Non-goals (for now)**

- High-fidelity 3D vehicle physics, suspension geometry, gearbox simulation.
- Online multiplayer, public leaderboard website, user accounts.
- Official Formula 1 branding: no F1 logos, team names or liveries. Generic open-wheel cars only.

---

## 2. Inspiration and key difference

Inspired by a Reddit post where four LLMs sailed a yacht race: every 5 seconds each model received ~23 raw numbers and set helm and sails, with the simulation paused while it thought.

**Our approach differs on purpose: code as policy.** The LLM does not drive in the loop. It writes a program once (or iterates on it during practice), and that program drives in real time at a fixed rate. Consequences:

- Races run in real time, no pauses, no API calls during a race.
- Runs are cheap, fast and exactly reproducible.
- The benchmark measures engineering skill: physics reasoning, algorithms (racing line, speed profile, path tracking) and code quality.

---

## 3. Design principles (firm)

1. **Determinism.** A race result is a pure function of `(sim version, track, car config, driver code, seed)`. Fixed timestep. Seeded PRNG only. No `Date`, `Math.random` or wall-clock dependency inside the sim or the sandbox. Same inputs → bit-identical replay hash.
2. **Strict separation.** The sim has no rendering dependency. The viewer contains no physics: it only plays replays. What viewers see is exactly what was timed.
3. **Fairness.** Every driver gets the same information, the same compute budget, the same sandbox and the same rules.
4. **Fast headless runs.** Practice loops must be cheap so agentic models can iterate. Target: one full lap with a sandboxed driver in a few seconds of wall time on a laptop.
5. **Observability.** Every run emits telemetry and a human-readable and LLM-readable summary.
6. **Versioned results.** Replays and results embed sim version, driver API version and DDK version so past results stay interpretable.

---

## 4. Architecture overview

```
            ┌──────────────┐
 tracks/ ──▶│  Track model │──┐
            └──────────────┘  │     ┌──────────────────┐
            ┌──────────────┐  ├────▶│   Sim core        │──▶ replay.json
 car cfg ──▶│ Vehicle model│──┘     │ (fixed timestep,  │──▶ telemetry.csv
            └──────────────┘        │  race control)    │──▶ results.json
                                    └────────▲─────────┘
                                             │ step(telemetry) → controls
                                    ┌────────┴─────────┐
 drivers/*.js ─────────────────────▶│ Sandbox (QuickJS)│
                                    └──────────────────┘

 replay.json ──▶ Viewer (React Three Fiber)  ──▶ browser, shareable link
 replay.json ──▶ Video (Remotion)            ──▶ MP4 9:16 / 1:1 / 16:9
```

### Suggested stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript everywhere (strict) | Same sim code in Node and browser |
| Monorepo | pnpm workspaces | Turborepo optional |
| Tests | Vitest | |
| Lint/format | Biome or ESLint + Prettier | Agent's choice |
| Physics | Custom 2D model in `packages/sim` | No 3D physics engine: harder to keep deterministic, slower |
| Driver sandbox | `quickjs-emscripten` (QuickJS compiled to WASM) | Memory limit, interrupt handler, no host APIs |
| Viewer | Vite + React + `@react-three/fiber` + `@react-three/drei` | |
| Video | Remotion (+ `@remotion/three`) | Phase 4 |
| Real track data | TUMFTM `racetrack-database` (centerline x/y + left/right widths, meters) | Check the license before redistributing |

### Suggested repo layout

```
f1-llm-bench/
  packages/
    sim/          # pure TS: geometry, vehicle, race control, replay writer
    sandbox/      # driver runtime: QuickJS context, budgets, validation
    cli/          # bench validate | practice | qualify | race | leaderboard
  apps/
    viewer/       # 3D replay viewer
    video/        # Remotion compositions (phase 4)
  ddk/            # Driver Development Kit (what LLMs receive)
  tracks/         # track JSON files (+ importers in packages/sim or scripts/)
  drivers/        # submitted drivers: drivers/<event>/<model-slug>/driver.js
  results/        # replays, telemetry, manifests (large files gitignored)
  docs/           # DECISIONS.md, PHYSICS.md, REPLAY_FORMAT.md
```

---

## 5. Simulation core (`packages/sim`)

### 5.1 Units and coordinates

- SI units everywhere: meters, seconds, kilograms, radians, newtons.
- World plane is `x, y` (z is up in the viewer only).
- Track-relative **Frenet coordinates**: `s` = distance along the centerline from the start line, `n` = signed lateral offset (positive = left).

### 5.2 Track model

- Input: closed centerline as points with left/right widths.
- Preprocessing: resample to a fixed spacing (1 to 2 m) along a smooth closed spline. Precompute per sample: `s`, position, heading, curvature, normal, widths.
- **Frenet projection must be local**: search near the car's previous `s` to avoid snapping onto a nearby parallel section of track.
- Surface zones by lateral offset: `track`, `kerb` (inside of corners above a curvature threshold), `runoff` (grass or gravel: lower grip, extra drag), `barrier` (impact).
- Start/finish line at `s = 0`, three sectors.

**Initial track file format** (adapt freely, document in `docs/`):

```json
{
  "id": "proto-ring",
  "name": "Prototype Ring",
  "version": 1,
  "closed": true,
  "points": [[x, y, widthRight, widthLeft], ...],
  "sectors": [s1End, s2End],   // implemented as fractions of the lap, see docs/TRACK_FORMAT.md
  "runoff": { "default": { "type": "grass", "width": 15 } }
}
```

**First track: handmade "Prototype Ring"**, about 4 km, 12 to 15 m wide, built from a closed spline with ~12 to 16 control points. It must contain:

- a long straight (~1 km) into a heavy-braking hairpin (tests braking),
- a chicane (tests fast direction changes),
- a fast sweeper taken flat or nearly flat (tests understanding of aero grip),
- a long-radius or double-apex corner,
- a medium-speed esses section.

**Importer** for TUMFTM CSV files (`x_m, y_m, w_tr_right_m, w_tr_left_m`) in phase 4.

### 5.3 Vehicle model

Start with a **dynamic bicycle model** (one front axle, one rear axle). State: `x, y, yaw, vx, vy, yawRate`, plus actuator states.

Forces:

- **Tires**: simplified Pacejka "magic formula" for lateral force per axle; vertical load = static weight split + aero downforce (+ optional longitudinal load transfer).
- **Combined slip**: friction ellipse or circle, so braking while turning reduces lateral grip.
- **Powertrain**: drive force = `min(P / v, traction limit)`; no gearbox at first (optional later for visuals and sound).
- **Brakes**: force capped by available grip; lock-up optional.
- **Aero**: drag `0.5·ρ·CdA·v²`, downforce `0.5·ρ·ClA·v²` split front/rear.
- **Rolling resistance**, small constant.
- **Low speed**: blend toward a kinematic model below ~5 m/s to avoid singularities as `vx → 0`.
- **Actuators** with rate limits (steering rate, throttle and brake application), so bang-bang control is not unrealistically optimal.

Integration: semi-implicit Euler or RK4, physics at 200 Hz (agent decides, documents in `docs/PHYSICS.md`).

**Starting parameters** (tune to hit the plausibility targets below, values are not sacred):

| Parameter | Start value |
|---|---|
| Mass (car + driver) | 800 kg |
| Wheelbase | 3.6 m |
| Weight distribution front/rear | 45 / 55 |
| Max power | ~740 kW |
| CdA | ~1.2 m² |
| ClA | ~4.0 m² |
| Peak tire friction coefficient | ~1.7 |
| Max steering angle | ~0.35 rad (at the wheels) |

**Plausibility targets** (sanity tests, orders of magnitude):

- top speed 320 to 350 km/h on the long straight,
- peak braking 4.5 to 5.5 g from high speed,
- 4 to 5 g lateral in fast corners, around 2 g in slow corners,
- 0 to 100 km/h in roughly 2.5 to 3 s (traction limited).

**Surfaces** (start values): track grip ×1.0; kerb ×0.9; grass ×0.5 + drag; gravel ×0.4 + heavy drag; barrier → impact (crash above a speed threshold, otherwise stop and continue).

### 5.4 Race control

- Laps and sector times. A lap counts only if all sector checkpoints were crossed in order (prevents shortcuts and reverse driving).
- **Track limits**: off-track when the car center is beyond the track edge by more than ~half the car width. Qualifying: lap deleted. Race: warnings then time penalty (e.g. +5 s).
- **Statuses** (shown in the viewer, they are part of the show): `RUNNING`, `FINISHED`, `DNF: CRASHED`, `DNF: STALLED` (speed < 1 m/s for > 10 s), `DNF: ECU FAILURE` (driver code errors, see section 7), `TIME UP`.
- Global session time limit.

### 5.5 Replay and determinism

- Replay = header + frames. Header: sim version, API version, track id + hash, car config hash, driver hashes, seed, session type.
- Frames at 50 Hz per car: `t, x, y, yaw, speed, steer, throttle, brake, surface, lap, s` + events (lap completed, sector, off-track, penalty, crash, status change).
- JSON for the prototype (gzip on disk). Switch to a binary format only if size becomes a problem.
- **Determinism test in CI**: run the same race twice, compare replay hashes.

### 5.6 Multi-car

- **Phases 1 to 4: ghost mode.** Each car runs alone in its own world, the replay overlays them ("separate runs, same conditions, shown together"). Simple and fair.
- **Phase 5: shared world** with collisions, slipstream, dirty air and opponent data in the API.

---

## 6. Driver API (initial contract)

### 6.1 Module shape

A driver is a single ES module (JavaScript; TypeScript accepted and transpiled by the harness with esbuild before sandboxing).

```ts
// ddk/driver.d.ts (initial, will evolve)
export function init(track: TrackInfo, car: CarSpec): void;   // called once
export function step(t: Telemetry): Controls;                 // called at 50 Hz
```

Module scope holds state between calls.

### 6.2 Inputs

```ts
interface TrackInfo {
  apiVersion: string;
  length: number;                 // m
  sampleSpacing: number;          // m
  samples: Array<{
    s: number; x: number; y: number;
    heading: number; curvature: number;   // rad, 1/m
    widthLeft: number; widthRight: number; // m
  }>;
  sectors: number[];              // s values
}

interface CarSpec {               // public parameters only (see 6.4)
  mass: number; wheelbase: number; width: number;
  maxSteer: number; maxPower?: number; /* ... */
}

interface Telemetry {
  t: number; lap: number; lapTime: number; sector: number;
  s: number; n: number; headingError: number;   // Frenet state
  x: number; y: number; yaw: number;            // world state
  speed: number; vx: number; vy: number; yawRate: number;
  ax: number; ay: number;                       // body-frame accel
  steer: number; throttle: number; brake: number; // actual actuator state
  surface: "track" | "kerb" | "grass" | "gravel";
  offTrackWarnings: number;
}
```

### 6.3 Outputs

```ts
interface Controls {
  throttle: number;  // 0..1
  brake: number;     // 0..1
  steer: number;     // -1..1 (fraction of maxSteer, positive = left)
}
```

The harness clamps values and replaces `NaN` or missing fields with the previous command (and records a strike, see section 7).

### 6.4 Information policy (open decision, see section 14)

- **Level A, fully documented**: equations and all constants published.
- **Level B, partially documented (recommended default)**: API, rules, qualitative physics description and public car parameters are published; tire and aero constants are hidden and must be inferred from practice telemetry.

Implement the car config with explicit `public` and `hidden` sections so both levels are a config switch.

### 6.5 API freeze and seasons

Once a benchmark event has been run, the API and sim behavior for that **season** are frozen (`apiVersion`, `simVersion`). Breaking changes start a new season.

---

## 7. Sandbox (`packages/sandbox`)

Driver code is **untrusted**.

- One QuickJS runtime/context per driver. No host APIs except what the harness injects. Remove or replace `Date`; seed or remove `Math.random`.
- Memory limit (start: 64 MB).
- Compute budgets via the interrupt handler. Start values, to calibrate against the baseline driver: generous for `init` (precompute a racing line), tight for `step`.
- Verify the budget mechanism is deterministic. If it is not, use wall-clock budgets with generous margins and document the limitation.
- **Error policy**: an exception, invalid output or budget overrun in `step` = keep previous controls + one strike. Three strikes, or any failure in `init` = `DNF: ECU FAILURE`.
- `log()` available in practice mode only, rate-limited, written to the run output.
- Keep the host/sandbox boundary cheap (telemetry passed 50 times per second; measure, consider a flat array if objects are slow).
- **Fallback** if QuickJS is too slow: `isolated-vm` in Node (weaker determinism of timing). Record the decision.

Sandbox tests: infinite loop, memory bomb, throw in `init`/`step`, NaN outputs, access attempts to `process`, `require`, `fetch`, `globalThis` tampering.

---

## 8. CLI (`packages/cli`)

Output is designed to be read by both humans and LLMs: a short text summary on stdout + paths to detailed files.

| Command | Purpose |
|---|---|
| `bench validate <driver>` | Load, run `init`, a few seconds of `step`, report errors and timings |
| `bench practice --driver <f> --track <id>` | One flying lap (the event's session): lap/sector times, events, `telemetry.csv` (s, speed, throttle, brake, steer, n, surface, ax, ay), `summary.json`; counts against the practice budget |
| `bench qualify --drivers <list> --track <id> --seed S` | One flying lap per driver, all from the same flying start; produces `replay.json.gz`, `results.json` (see D26) |
| `bench leaderboard <results-dir>` | Aggregated table across events |

Optional: `bench plot` producing a PNG speed/throttle/brake trace per lap, useful for models with vision.

---

## 9. Driver Development Kit and benchmark protocol

### 9.1 DDK contents (`ddk/`)

- `DRIVER_SPEC.md`: rules, API, physics description (per information level), budgets, error policy, scoring.
- `driver.d.ts`: types.
- `baseline-driver.js`: a simple but complete driver (path tracking on the centerline + conservative speed from curvature). It finishes laps slowly. Every model starts from a working base.
- `car-public.json`, practice track files.
- `PROMPT_ONESHOT.md` and `PROMPT_AGENTIC.md`.

### 9.2 Reference driver (internal, not in the DDK)

The agent builds a strong **house driver** (racing line optimization + forward/backward speed profile + path tracking). Uses:

- proves the physics leaves room for skill,
- gives a "reference lap" shown in results (e.g. "gap to reference: +1.8 s"),
- detects exploits.

### 9.3 Modes

- **One-shot**: the model receives the DDK in a single prompt and returns `driver.js`. One validate-and-fix round allowed (syntax or load errors only).
- **Agentic**: the model runs in a coding agent CLI (e.g. Claude Code, Codex CLI, Gemini CLI) inside an identical, isolated workspace containing only the DDK and its driver. It may call `bench practice` within a budget (e.g. N runs or M minutes).

**Isolation of hidden parameters (agentic)**: the agent must not read the sim source or hidden constants. Preferred: practice runs go through a small service (container or local HTTP server) outside the agent's workspace, which also counts runs. Prototype fallback: minified bundle + honor system, documented as a known gap.

### 9.4 Weekend format

Since D26 every session, practice included, is the same: one flying lap after a 3 s run-up placed
by the sim, every car crossing the line at the same speed; off-track deletes the lap.

1. **Practice** (agentic mode only): iterate within the budget.
2. **Event**: one flying lap on a circuit the models never practised on (ghost mode until phase 5).

### 9.5 Run manifest and metrics

Each submission stores `results/<event>/<model-slug>/manifest.json`:

- model id, provider, settings (reasoning effort, temperature), prompt version, DDK version, sim version,
- token usage, cost, wall time, practice runs used,
- driver hash, optional transcript.

Scored metrics: best lap, race time, penalties, status. Displayed metrics: also cost and tokens (they make the results more interesting to share).

A small script calls provider APIs for one-shot runs (direct SDKs or a single gateway like OpenRouter for uniform access and cost tracking).

---

## 10. Viewer (`apps/viewer`)

**Goal: pleasant, readable, broadcast-like.** Not photorealistic.

- Load a replay by file drop or URL parameter.
- **Track mesh generated from the centerline**: asphalt ribbon, white edge lines, red/white kerbs on corners, grass and gravel runoff, simple barriers, start/finish gantry, sector markers. Low-poly scenery (grandstands, trees) as instanced meshes. Sky, soft shadows.
- **Cars**: generic low-poly open-wheelers (procedural or CC0 glTF), one color per model, name label above each car, optional trail ribbon colored per car (as in the sailing video).
- **Cameras**: helicopter/TV auto-director (follows the leader or the closest battle), chase cam, onboard, top-down map. Keyboard shortcuts. Smooth interpolation between 50 Hz frames.
- **HUD**: timing tower (position, model, gap, lap, status), session clock + playback speed (1×, 4×, 30×), per-car mini telemetry (speed, throttle/brake bars), final classification card (lap times, gap to reference, cost).
- **Analysis view**: speed trace comparison of best laps, plotted against `s`.
- Playback controls: play/pause, scrub, speed.
- 60 fps on a laptop. Mobile-friendly is a phase 4 goal (shared links get opened on phones).

---

## 11. Video export (`apps/video`, phase 4)

- Remotion compositions in 9:16, 1:1 and 16:9, rendered frame by frame from the replay (deterministic).
- Structure: intro card ("4 AI models, one circuit"), race with auto-director, highlight callouts (crash, fastest lap, track limits, overtakes once phase 5 exists), final classification card with times and costs.
- Quick alternative for early clips: canvas capture (MediaRecorder) from the viewer.

---

## 12. Phases and milestones

Ordering is indicative. The agent may re-slice phases as long as each acceptance criterion is eventually met.

### Phase 0: Scaffolding

- Monorepo, TS strict, tests, lint, CI (tests + determinism check), `docs/DECISIONS.md`.
- **Done when**: `pnpm test` passes in CI on an empty skeleton with one smoke test.

### Phase 1: Headless sim + baseline

- Track model + Prototype Ring, vehicle model, race control, replay writer, `bench practice`, baseline driver running **unsandboxed** (plain import) to move fast.
- **Done when**:
  - the baseline completes 3 laps without DNF,
  - a quick reference driver reaches the plausibility targets (5.3),
  - determinism test passes,
  - performance target met (principle 4).

### Phase 2: Viewer MVP

- Replay loading, generated 3D track, cars, chase + helicopter cameras, timing tower, playback controls.
- **Done when**: a replay with 4 ghost cars (baseline variants with different speed factors are fine) plays smoothly at 60 fps, and a screenshot looks good enough to post.

### Phase 3: Sandbox, DDK, first benchmark

- QuickJS sandbox with budgets and error policy, DDK docs and prompts, house reference driver, manifests, leaderboard.
- First event: one-shot for 3 to 4 models (frontier + one small open model), agentic for at least 2.
- **Done when**: leaderboard generated, every result reproducible from its manifest, replay viewable in the viewer.

### Phase 4: Real circuits and shareable content

- TUMFTM importer (license checked), several real circuits, Remotion export, mobile-friendly viewer, Mystery GP.
- **Done when**: a 30 to 60 s vertical video of a full event is rendered from a replay with no manual editing.

### Phase 5: Wheel-to-wheel racing

- Shared world, collisions, slipstream, dirty air, opponent info in the API (new season), tire wear and temperature, optional pit stops and strategy, multi-track season standings.
- **Done when**: a 4-car race with overtakes and at least one collision rule enforced is reproducible and viewable.

---

## 13. Testing strategy

- **Geometry**: Frenet projection round-trip, curvature on known shapes (circle, straight), local search near parallel sections.
- **Vehicle**: steady-state checks (top speed, braking distance, steady cornering grip vs speed), no NaN/Infinity under extreme inputs.
- **Race control**: shortcut attempts, reverse driving, stalls, track-limit penalties.
- **Determinism**: golden replay hashes.
- **Sandbox**: adversarial drivers (section 7).
- **Exploit hunting**: after each physics change, run the house driver and a few adversarial drivers (e.g. chicane cutting, max steer at top speed) and check nothing absurd is faster.

---

## 14. Open decisions (recommended default in bold)

| Decision | Options | Default |
|---|---|---|
| Information policy | A documented / B partially hidden | **B**, with A as a config switch |
| Driver language | JS / TS / Python | **JS, TS transpiled** |
| Sandbox | QuickJS-wasm / isolated-vm | **QuickJS** unless perf blocks |
| Driver rate | 50 Hz / 100 Hz | **50 Hz** |
| Replay format | JSON.gz / binary | **JSON.gz** |
| Hidden-param isolation (agentic) | service / container / honor system | **service**, honor system as fallback |
| Practice budget | runs / time / tokens | **runs** (simplest to explain) |
| Project name | | TBD by owner |

---

## 15. Risks and mitigations

- **Convergence**: with full information on a known track, strong models will all implement the textbook recipe and finish within tenths. Mitigate with hidden constants (level B), a hidden track, sensor noise per seed, then tire wear and wheel-to-wheel racing.
- **Unrealistic or exploitable physics**: guarded by checkpoints, track limits, the reference driver and exploit tests.
- **Sandbox performance**: measure early in phase 3; fallback documented.
- **Licensing**: track data and 3D assets must allow redistribution; no F1 trademarks or team branding.
- **Visual scope creep**: visuals serve the story; timebox polish, prioritize readability (who is ahead, by how much, what went wrong).

---

## 16. References

- TUMFTM racetrack-database: centerlines and widths of 20+ circuits (GitHub).
- TUMFTM global_racetrajectory_optimization: minimum-curvature racing line (useful for the house driver).
- TORCS / Simulated Car Racing Championship: prior art for sensor-based driver APIs.
- F1TENTH: autonomous racing community, path tracking and planning methods.
- Pacejka "magic formula" tire model, dynamic bicycle model (standard vehicle dynamics references).
