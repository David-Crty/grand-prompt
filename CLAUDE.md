# Grand Prompt

LLMs each write a driving program once (`bench build`), practising on a few circuits, then all
programs drive one flying lap in the same car on every circuit, the unpractised ones included, in
a deterministic simulator (`bench race`), and the laps are replayed together in 3D (`apps/viewer`). The README says how to use it;
this file is for working on it.

## Principles (ask the owner before changing these)
- **Determinism.** A result is a pure function of (sim version, track, car, driver code, seed):
  fixed timestep, seeded PRNG, no `Date`, `Math.random` or wall clock in the sim or the sandbox.
  Same inputs, bit-identical state hash.
- **Separation.** The sim has no rendering dependency; the viewer runs no physics and only plays
  replays. What viewers see is exactly what was timed: nothing moves a car to make it look better.
- **Fairness.** Every driver gets the same information (the DDK, public car parameters only), the
  same compute budget, the same sandbox and the same session.
- **Versioned results.** Replays and results carry `SIM_VERSION`, `API_VERSION` and `DDK_VERSION`
  (`packages/sim/src/version.ts`).
- **Ask** before freezing the driver API for a season, or before anything that invalidates past
  results.

## Status
- Done: sim, sandbox, DDK, practice service, sandboxed agentic builds, races, viewer (desktop and
  phone) with the race list and the drivers' standings.
- `gp-1`: 9 Claude and GPT models, built for the flying-lap session at medium effort
  (`agentic-0.5`); `pnpm determinism` uses its drivers.
- Not done: Gemini ids in `models.json` (the Gemini CLI is not
  installed here); the video export (Remotion); wheel-to-wheel racing (shared world, collisions,
  a new API season).
- Known: runoff clipping (`clipRunoffByProximity` in `track.ts`) only looks
  `maxRunoff + 2·maxWidth + 5` m around a sample, so sections slightly farther apart can keep
  overlapping runoff. Fixing it changes results (golden hashes, `SIM_VERSION`).

## Layout
- `packages/sim`: pure TS, browser-safe. `track/` (spline, Frenet projection, surfaces, the import
  helpers), `vehicle.ts` (bicycle model, Pacejka, aero; constants in `cars/proto.json`), `race.ts`
  (`CarSim`: one car's run-up and flying lap, race control), `session.ts` (ghost mode: every car
  alone, then classified), `replay.ts` (the format the viewer plays), `telemetry.ts` (CSV and the
  text summary drivers' authors read).
- `packages/sandbox`: QuickJS runtime for untrusted drivers; budgets count interrupt-handler
  calls, so they are deterministic.
- `packages/cli`: `bench` (`src/index.ts` is the option table and dispatch). `session.ts`
  validate/practice, `event.ts` races (an event on every circuit) and reproduce,
  `tracks.ts` list and import, `service.ts` + `workspace.ts` the practice service, `build/` the
  agentic builds (`lib.ts` is the tested pure part; `run.ts`, `index.tsx` and the Ink view `ui.tsx`
  are run by hand).
- `packages/ui`: the design system shared by the viewer (and a future video). Tokens in
  `tokens.json` (`make tokens` regenerates `tokens.gen.*`), styles in `components.css` (prefix
  `gp-`), presentational React components in `src/react`, entries (code, colour slot, provider)
  from `resolveEntries`, filled from the roster `models.json` (`roster.ts`) for the models it lists.
- `apps/viewer`: Vite + React Three Fiber. Pure logic in `src/lib` (tested), the 3D scene in
  `src/scene`, the HUD in `src/components`, the pages by path in `src/lib/route.ts` (`/`, `/drivers`,
  `/races/<id>`). The dev server serves `results/` at `/results/` and builds `/results/index.json`
  per request (`server/results-index.ts`). The car mesh
  `src/lib/car-model.gen.json` comes from `cars/sources/*.stl` (`make car`).
- `ddk/`: everything a model sees: `DRIVER_SPEC.md`, `driver.d.ts`, `baseline-driver.js`,
  `car-public.json`, the practice client `bench-client.mjs`, the brief `PROMPT_AGENTIC.md` (copied
  as `TASK.md`) and the launch prompt `PROMPT_LAUNCH.md`.
- `drivers/<event>/`: an event's inputs: `event.json` (circuit, seed) and one folder per model
  with `driver.js` and `manifest.json`. `results/` is generated output only, not committed:
  `races/<event>-<track>/` every race, `builds/<event>/` build logs,
  `practice/` and `agentic/` practice runs.
- `tracks/<id>.json`: circuits; `tracks/sources/`: the raw extracts they are imported from.
- `scripts/`: `determinism-check.ts` (CI), `gen-tokens.ts`, `import-car.ts`, `build-site.ts` (the
  static site: viewer build, published result files, `results/index.json`, Pages `_headers`).

## Deployment
https://llm-racing.crty.dev, on Cloudflare Pages. The `deploy` job in `.github/workflows/ci.yml` runs
after the gates on every push to `main`: it reruns every event in `drivers/` (results are never
committed), builds the viewer and the site, then `wrangler pages deploy`. Only the files listed in
`build-site.ts` leave `results/races/`; Pages serves index.html for the viewer's paths because the
site has no 404.html. The infrastructure is Terraform in `David-Crty/infra`
(`terraform/llm-racing`).

## Commands
```bash
make                                    # the shortcuts
pnpm bench --help                       # every command
pnpm bench practice ddk/baseline-driver.js --track monaco
pnpm bench race gp-1                    # drivers/gp-1/* on every circuit -> results/races/gp-1-<track>/
pnpm --filter @bench/viewer dev         # http://localhost:5173/
```

## Quality gates (all of them before calling work done: `make gates`)
```bash
pnpm lint && pnpm typecheck && pnpm coverage && pnpm determinism && pnpm --filter @bench/viewer build
```
- Coverage must stay ≥ 90% (lines, statements, functions, branches) over `packages/*/src`,
  `apps/viewer/src/lib` and `apps/viewer/server` (`vitest.config.ts`). Balance unit tests with
  feature tests that run real sessions (`sim/test/race.test.ts`, `cli/test/cli.test.ts`).
- Any change to physics, race control or track processing changes the golden hashes: regenerate
  them with `make golden`, bump `SIM_VERSION`, and check the plausibility targets in
  `sim/test/vehicle.test.ts` still hold.
- `sim/test/race.test.ts` holds the rules that stop exploits (checkpoints against cutting and
  reversing, track limits, barriers, full lock at speed); keep them passing after physics changes.

## Conventions and gotchas
- The DDK is what models read. Changing it (or the `Telemetry`/`TrackInfo`/`CarSpec`/`Controls`
  shapes, which `sim/test/ddk.test.ts` checks against `driver.d.ts`) changes the benchmark: bump
  `DDK_VERSION` or `API_VERSION` and say so. Hidden car constants (aero, tyres, brakes) never go in
  it.
- Every race is one flying lap, so there is no session type to choose. One comes with the API season
  that brings wheel-to-wheel racing, not before.
- Results are produced sandboxed; sandboxed and unsandboxed hashes differ (QuickJS has its own
  libm).
- Track `sectors` and runoff zones are lap fractions, not metres.
- Tests that write results use a temporary `BENCH_ROOT`, never the repo's `results/`.
- `drivers/` and `**/*.md` are excluded from Biome: submissions must stay byte-identical to their
  hashes, and Biome mangles the `{{…}}` prompt placeholders.
- Practice tokens live in one file, `results/agentic/tokens.json`, rewritten on each
  registration: never create workspaces concurrently.
- Builds run the model CLIs with their own permission prompts off inside bubblewrap; Claude Code's
  auto mode blocks launching them, so the owner runs builds. Tests never start a model.
- UI: values come from tokens, never a hex in a component; a car is identified by its entry
  (`resolveEntries`), never by a colour in the replay; logic goes in tested pure modules, not in
  components. The visual reference is the owner's design canvas on claude.ai.
- No F1 branding, team names or liveries.

## Git
Early development: commit directly on `main`, no branches or merge requests unless the owner asks.
Run the gates before each commit. There is no decision log: put the why of a significant choice
in its commit message.
