# LLM Racing

Each model writes a JavaScript driver once (`bench build`, practising on Monaco, Silverstone and
Portimão). Then every driver does one flying lap in the same car, alone, on every circuit, in a
deterministic sim (`bench race`), and the viewer replays the laps together in 3D. The README covers
usage; this file covers working on the code. `make` lists the shortcuts, `pnpm bench --help` the
commands.

## Principles (ask the owner before changing any)
- **Determinism.** A result is a pure function of (sim version, track, car, driver code, seed):
  fixed timestep, seeded PRNG, no `Date`, `Math.random` or wall clock in the sim or the sandbox.
- **Separation.** The sim has no rendering dependency. The viewer runs no physics and only plays
  replays: nothing moves a car to make it look better.
- **Fairness.** Every driver gets the same driver development kit (public car parameters only),
  compute budget, sandbox and session.
- **Versioning.** Replays and results carry `SIM_VERSION`, `API_VERSION` and
  `DRIVER_DEVELOPMENT_KIT_VERSION` (`packages/sim/src/version.ts`). Ask before anything that
  invalidates past results.

## Map
- `packages/sim`: pure TS, browser-safe. `track/` (spline, Frenet projection, surfaces, import),
  `vehicle.ts` (bicycle model, Pacejka, aero), `race.ts` (`CarSim`: run-up, flying lap, race
  control), `session.ts` (ghost mode), `replay.ts`, `telemetry.ts`.
- `packages/sandbox`: QuickJS for untrusted drivers. Budgets count interrupt-handler calls, not time.
- `packages/cli`: `bench`. `index.ts` options and dispatch, `load.ts` repo root, car, driver
  loading and hashes, `session.ts` validate/practice, `event.ts` race/reproduce, `tracks.ts`
  circuits, `service.ts` + `workspace.ts` the practice service, `build/` the agentic builds
  (`lib.ts` is tested; `run.ts`, `index.tsx`, `ui.tsx` are run by hand and excluded from coverage).
- `packages/ui`: the design system. `tokens.json` → `tokens.gen.*` (`make tokens`),
  `components.css` (prefix `gp-`), React components in `src/react`, entries in `entries.ts` and
  `roster.ts`.
- `apps/viewer`: Vite + React Three Fiber. Tested logic in `src/lib`, 3D in `src/scene`, HUD and
  pages in `src/components`, routes in `src/lib/route.ts`. The dev server serves `results/` and
  builds `/results/index.json` per request (`server/results-index.ts`).
- `driver-development-kit/`: everything a model sees. `PROMPT_AGENTIC.md` (copied in as
  `TASK.md`) carries the prompt version (`agentic-0.5`) that each manifest records.
- `models.json`: the roster (providers with their CLI and car body; models with id, name, code,
  colour). `prices.json`: list prices for the build cost when a CLI reports none (Codex,
  `agy`). `site.json`: `defaultEvent`, the event the race and driver lists open on (`?event=`
  picks another); the site build fails if it has no races.
- `cars/proto.json`: the full car, hidden constants included. `cars/sources/*.stl` → the viewer's
  mesh (`make car`).
- `drivers/<event>/`: `event.json` (name, seed) and `<model>/driver.js` + `manifest.json`.
- `tracks/<id>.json`, imported from `tracks/sources/` (`bench tracks import`).
- `results/` and `site/`: generated, never committed.
- `scripts/`: `determinism-check.ts`, `build-site.ts`, `gen-tokens.ts`, `import-car.ts`.

## Quality gates
`make gates` (lint, typecheck, coverage, determinism, viewer build) before calling work done and
before each commit.
- Coverage ≥ 90% on lines, statements, functions and branches (`vitest.config.ts`). Pair unit tests
  with feature tests that run real sessions (`sim/test/race.test.ts`, `cli/test/cli.test.ts`).
- `pnpm determinism` races the `r1-medium` drivers on proto-ring in two processes and compares hashes.
- Changing physics, race control or track processing moves the golden hashes: `make golden`, bump
  `SIM_VERSION`, check the plausibility targets in `sim/test/vehicle.test.ts`. The anti-exploit
  rules in `sim/test/race.test.ts` (checkpoints, track limits, barriers, full lock at speed) must
  keep passing.

## Gotchas
- The driver development kit is the benchmark. Changing it, or the `Telemetry`/`TrackInfo`/
  `CarSpec`/`Controls` shapes (`sim/test/driver-development-kit.test.ts` checks them against
  `driver.d.ts`), means bumping `DRIVER_DEVELOPMENT_KIT_VERSION` or `API_VERSION` and saying so.
  Hidden constants (aero, tyres, brakes) never go in it.
- Results are always sandboxed: sandboxed and unsandboxed hashes differ (QuickJS has its own libm).
- Track `sectors` and runoff zones are lap fractions, not metres.
- Tests that write results use a temporary `BENCH_ROOT`, never the repo's `results/`.
- Biome skips `drivers/` (submissions must stay byte-identical to their hashes) and `**/*.md` (it
  mangles the `{{…}}` prompt placeholders).
- `results/agentic/tokens.json` is rewritten on each workspace registration: never create
  workspaces concurrently.
- The owner runs builds: auto mode blocks launching the model CLIs, which run with their own
  permission prompts off inside bubblewrap. Tests never start a model.
- `agy` keeps its token in the desktop keyring, so a build can hide `~/.gemini/antigravity-cli` and
  `~/.gemini/config` (the owner's conversations, memories, skills) behind a tmpfs and still
  authenticate. Its web and MCP tools are denied by `AGY_DENY` (`build/lib.ts`); `search_web` has
  no documented rule.
- A new model goes in `models.json` and, if its CLI reports no cost, in `prices.json`.
- UI: values come from tokens, never a hex in a component; a car is identified by its entry
  (`resolveEntries`), never by a colour in the replay; logic goes in tested pure modules, not in
  components. The visual reference is the owner's design canvas on claude.ai.
- No F1 branding, team names or liveries.

## Status
- `r1-medium`: 11 Claude, GPT and Gemini models at medium effort.
- Known: `clipRunoffByProximity` (`track.ts`) only looks `maxRunoff + 2·maxWidth + 5` m around a
  sample, so sections slightly farther apart can keep overlapping runoff. Fixing it changes results.

## Deployment
https://llm-racing.crty.dev on Cloudflare Pages. On every push to `main`, the `deploy` job in
`.github/workflows/ci.yml` runs after the gates: it reruns every event in `drivers/`, builds the
viewer (with Umami, via `UMAMI_WEBSITE_ID`) and `site/`, then `wrangler pages deploy`. Only the
`PUBLISHED` files in `build-site.ts` leave `results/races/`. The site has no 404.html, so Pages
serves index.html for the viewer's paths. Infrastructure: Terraform in `David-Crty/infra`
(`terraform/llm-racing`).

## Git
Commit directly on `main`; branches only if the owner asks. No decision log: the why of a
significant choice goes in its commit message.
