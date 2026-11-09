# Decisions

One entry per significant choice or deviation from PLAN.md: context, choice, consequences.

## D1. Toolchain: TS 7, Node 26, pnpm 12, Vitest 5, Biome 2 (2026-11-09)
- Context: the plan suggests TS strict, pnpm workspaces, Vitest, Biome or ESLint.
- Choice: the latest stable releases. Internal packages export their TS sources directly
  (`exports: ./src/index.ts`); dev scripts run through `tsx`; no build step for libraries.
  Biome for lint and format, with Markdown excluded (it mangled the `{{…}}` prompt placeholders).
- Consequences: no `dist/` to keep in sync. The viewer (Vite) and tests consume the sources directly.

## D2. Physics at 500 Hz, semi-implicit Euler, driver at 50 Hz (2026-11-09)
- Context: the plan leaves the integrator and rate to the agent.
- Choice: 10 physics substeps per 20 ms driver tick. Semi-implicit Euler is stable at
  dt = 2 ms down to the 1.5 to 4.5 m/s kinematic blend (see PHYSICS.md for the stiffness estimate).
- Consequences: about 45k physics steps per lap; an unsandboxed lap simulates in ~60 ms.

## D3. Handmade track built from segments, stored as points (2026-11-09)
- Context: the plan suggests a closed spline through ~12 to 16 control points.
- Choice: `scripts/gen-proto-ring.ts` describes the Prototype Ring as straights and corners
  with clothoid transitions (exact, readable corner radii). Two straights are solved for closure.
  The generator writes the generic track file format (points every 4 m), which the loader fits
  with a periodic C2 cubic spline and resamples every ~2 m. TUMFTM imports will use the same path.
- Consequences: the corner radii in the file are the design intent, and curvature is continuous.
  The track is 4047 m with a 969 m main straight into an R16 hairpin, a chicane, an R230
  sweeper (flat), esses, a double apex and a fast R135 final corner.

## D4. Track file positions as lap fractions (2026-11-09)
- Choice: `sectors` and runoff zone `from`/`to` are fractions of the lap (0..1), not metres.
  Spline resampling changes the length slightly, and fractions stay valid.

## D5. Runoff clipped by proximity (2026-11-09)
- Context: on a compact layout, the 15 m runoffs of neighbouring sections overlap.
- Choice: track preprocessing puts the barrier halfway between two track edges when another
  section (more than 150 m away along s) runs close by. Shortcuts are physically blocked by barriers.

## D6. Track limits and penalties (2026-11-09)
- Choice: off track = car centre more than half the car width (1.0 m) beyond the white line,
  with a 0.3 m hysteresis to return. Any off-track moment invalidates the lap in every session
  type. Race: the first 3 excursions are warnings, then each excursion costs +5 s.
- Kerbs (1.2 m, grip ×0.9) sit outside the white line on the inside of corners where
  |curvature| > 1/250 (dilated 12 m).

## D7. Barrier contact (2026-11-09)
- Choice: barrier at `width + runoffWidth` (car body = centre + half width). Above 12 m/s it is
  `DNF: CRASHED`. Below, the car is stopped and placed 0.3 m inside the barrier, then continues.

## D8. Vehicle parameters tuned to the plausibility targets (2026-11-09)
- Choice (cars/proto.json): CdA 1.35, ClA 3.6, aero balance 40% front, mu 1.75 (load
  sensitivity 0.06), Pacejka B 17 front / 19 rear (rear stiffer for stability), C 1.55, a brake
  system cap of 34 kN, and 14 kN max drive force.
- Measured (scripts/plausibility.ts, asserted in tests): top speed 341 km/h, 0–100 in 2.56 s,
  peak braking 5.26 g, lateral 1.9 g at 72 km/h and 4.2 g at 306 km/h.
- The brake cap is what reconciles the braking target (≤ 5.5 g) with the lateral one (4 to 5 g):
  without it, grip plus drag at top speed gives over 6.5 g.
- Consequence: full throttle below ~190 km/h exceeds rear traction, so the rear spins. Drivers
  must modulate the throttle. This is documented qualitatively in DRIVER_SPEC.md.

## D9. Sandbox: QuickJS with counter-based budgets (2026-11-09)
- Choice: `quickjs-emscripten` (RELEASE_SYNC). Budgets count interrupt-handler calls, and QuickJS
  polls the handler every ~10k internal operations from a counter, so metering is deterministic
  (asserted in tests). Defaults: init 20,000 units, step 20 units. The house driver uses
  ~1,300 for init (a 2 s racing-line optimization) and ≤ 1 per step.
- A wall-clock backstop (30 s init, 2 s step) exists only for huge budgets. It is the one
  nondeterministic path, and it never fires with the defaults.
- Bridge: telemetry goes in and controls come out as JSON strings through a frozen closure that
  captured `JSON.parse`/`stringify` before the driver loaded, so tampering with globals cannot
  break it. `Date` is deleted, and `Math.random` is a seeded sfc32.
- Driver modules go through esbuild (bundle → IIFE), so TS is accepted. Imports of packages or
  Node built-ins fail at load time.
- Consequence: a sandboxed lap of the house driver takes about 0.5 s (plus 2 s for init), which
  is well inside the performance target. isolated-vm was not needed.

## D10. Ghost-mode race start (2026-11-09)
- Choice: every car starts from standstill on the line (s = 0) at t = 0. Lap 1 is the standing
  lap. Qualifying is an out lap plus K flying laps (default 1); practice reports flying laps.

## D11. Determinism scope (2026-11-09)
- Guarantee: bit-identical results for the same sim version, inputs and Node major version. Sim
  math uses V8's fdlibm-derived `Math.*`. Driver code runs in QuickJS (WASM) with its own libm,
  so a driver gives different hashes sandboxed and unsandboxed; benchmark results are always
  sandboxed.
- Checks: `packages/sim/test/golden.json` (golden hashes, regenerate with `UPDATE_GOLDEN=1`
  and bump `SIM_VERSION`), plus `pnpm determinism` (two separate processes must agree).

## D12. Agentic isolation via a practice service (2026-11-09)
- Choice: `bench serve` (local HTTP) runs practice outside the agent's workspace and counts runs
  per token (`results/agentic/tokens.json`). `bench workspace` builds a workspace containing only
  the DDK, the track file, a copy of the baseline as `driver.js`, and a zero-dependency client
  (`bench.mjs`). Validation is free; practice runs count.
- Gap: the service runs on the same machine. An agent with unrestricted shell could still read
  the repo if the agent CLI is not sandboxed to its workspace. Run agents in a container or with
  directory-scoped permissions.

## D13. Coverage ≥ 90% enforced (2026-11-09)
- Requested by the owner: a balance of unit and feature tests (real simulations), with a 90%
  minimum. Enforced in `vitest.config.ts` (lines, statements, functions and branches) over
  `packages/*/src` and the viewer's pure `src/lib`. The CLI entry shim `main.ts` is excluded.

## D14. First real circuits: Monaco, Silverstone, Portimão (2026-11-09)
- Choice: Silverstone comes from the TUMFTM racetrack-database (measured widths). TUMFTM has no
  Monaco or Portimão, so those two come from their OpenStreetMap circuit relations (148194 and
  7509968) with constant widths: 9 m for Monaco (OSM has no widths there, estimate), 14 m for
  Portimão (OSM `width=14`). The raw extracts are committed in `tracks/sources/`, and
  `scripts/import-tracks.ts` rebuilds the track files from them with the pure helpers in
  `packages/sim/src/track/import.ts` (chain ways, project, smooth with a 3-4 m Gaussian,
  resample at 5 m). Lengths land within 1% of the official ones.
- OSM relations are not always clean: Monaco's has an 18 m gap at Massenet and a stub way there.
  The importer bridges gaps up to 40 m; the two stub ways at that junction are excluded by id.
- Approximations: Monaco's runoff is the 3 m minimum (barriers are right there), the others use
  18 m of grass everywhere (no asphalt runoff surface yet). Sectors are lap thirds, not the
  official splits. The sim is 2D, so no elevation (Monaco's climb, Portimão's crests).
- Licensing: OSM-derived data is ODbL-1.0 (attribution, share-alike on the derived track files);
  TUMFTM is LGPL-3.0. Both are recorded in each file's `license` field. Check them before the
  repo or the track files are published.
- Known gap: the house reference driver crashes on all three (it was only ever tuned on the
  Prototype Ring). It starts on the centreline while the line can sit 6 m to one side at s = 0,
  and it spins on corner exits where the speed profile runs ahead of the car. The DDK baseline
  laps all three cleanly. Until the reference is fixed, `--reference` on these tracks gives a DNF
  instead of a reference lap.

## D15. Viewer home page lists the races in `results/` (2026-11-09)
- The viewer opens on a list of every replay under `results/` (newest first, filterable) instead
  of auto-loading the demo. A row shows track, session and laps, winner and time (or P1's best
  lap outside races), fastest lap, the field with how many were not classified, date, seed and sim
  version, and links to `?replay=<url>`. The HUD gets an "All races" link back.
- The list comes from `/results/index.json`, which the Vite dev/preview middleware rebuilds on
  every request by walking `results/` (depth 4). It reads `results.json` next to each replay, and
  falls back to the replay's header and classification (the demo has no `results.json`). Track
  names come from `tracks/<id>.json`. Nothing is written to disk, so no index can go stale and the
  CLI stays unaware of the viewer.
- Consequence: a static `vite build` has no index, and the page then says it cannot list races;
  `?replay=` and drag-and-drop still work. Publishing results statically would need the index
  written as a file.

## D16. Agentic practice budget defaults to 5 runs (2026-11-09)

- `DEFAULT_PRACTICE_BUDGET` in `packages/cli/src/workspace.ts` sets it; `--budget N` overrides it per workspace.
- A 3-lap practice run takes about 3 s of wall time, so an agentic run's length is the model's
  thinking between runs, not the simulator. Twenty runs made a single entry take many minutes; five
  keeps an event short and rewards planning runs over trial and error.

## D17. First agentic event: four Claude models on proto-gp-1 (2026-11-09)

Opus 5.5, Fable 5.1, Sonnet 5.5 and Haiku 5.5 each wrote a driver as a Claude Code subagent, in
a `bench workspace` outside the repo, practising through `bench serve`. All four finished
qualifying and the 5-lap race, and `event reproduce` matches. Opus qualified on 56.501, Fable on
59.799, Sonnet on 1:11.710 and Haiku on 1:14.820. What the run taught:

- **The house driver is not a ceiling.** Reference lap 1:10.600; two entries beat it by 10 to 14 s.
  The exploit tests only show that *known* tricks lose to it, not that it drives near the limit,
  so "gap to reference" currently reads as "gap to a mediocre driver". A faster reference is
  needed before the gap means anything. The table now prints negative gaps as `-14.100`.
- **Isolation was by instruction only.** A subagent has the host's full filesystem, so the
  workspace boundary relied on the prompt. Fine for a trial, not for a published result: a real
  event needs a container or an API-only runner with no shell outside the workspace.
- **Only the latest version of each family can run this way**: the Agent tool takes a family
  alias, so older Claude versions need `bench oneshot` through OpenRouter or an agentic runner
  that calls the API with an exact model id.
- **Unequal budgets.** The budget was 20 and was cut to 5 mid-run (D16), after every model had
  spent more (8 to 14 runs). These results are a trial, not a ranking; rerun at 5 runs each.
- **Precomputed lines.** Opus optimised a racing line offline and embedded it, keyed to the
  practice track. Legal, since the event track is the practice track, and it is the main reason
  for Mystery GP (PLAN, phase 4). Racing the same four drivers on the real circuits (5 laps,
  seed 2026) showed it: only Fable, which solves its line in `init`, finished all of Monaco,
  Silverstone and Portimão. Opus's fallback line crashed at Monaco and Portimão and took 275 s of
  track-limit penalties at Silverstone; Sonnet finished only Silverstone; Haiku finished none.
- **Strategy converged.** All four built a curvature-based speed profile from grip fitted to
  telemetry, then tracked it; the spread came from the racing line and from traction/slip
  control, which is where every crash happened (power oversteer on exit, rear breakaway when
  trail-braking).
- **Manifests can sit next to the driver** (`drivers/<event>/<slug>/manifest.json`); `event run`
  reads `results/<event>/<slug>/manifest.json` first, then that one. `drivers/` is excluded from
  Biome so submissions stay byte-identical to what was hashed.
- The agentic prompt (now `agentic-0.2`) tells the model to check its budget with `status` and to
  `validate` before each run, since five runs leave no room for load errors.
- Tokens and wall time per entry are in each manifest's `settings`/`usage`; the Agent tool gives
  a total only, without an input/output split or a cost.

## D18. Agentic builds through the vendors' own CLIs, sandboxed with bubblewrap (2026-11-09)

- No OpenRouter: the owner has no account and does not want one. `scripts/build-drivers.sh <name>`
  builds one driver per entry in `models.json` (provider -> list of `{id, name}`) by running that
  provider's coding CLI headless in its workspace: `claude -p`, `codex exec`, `gemini -p`. Each
  runs on the owner's own subscription. A provider whose CLI is missing is skipped.
- Isolation is real now, not by instruction (the gap D17 found). Each CLI runs in `bwrap` with the
  filesystem read-only, the repo, `~/Codes`, `~/bench-ws` and `/tmp` hidden, only its workspace
  writable at `/tmp/ws`, and its own state dir writable so it can authenticate. Session
  histories (`~/.claude/projects`, `~/.codex/sessions`, …) are empty tmpfs, since they hold earlier
  transcripts with other models' drivers, and the user-level `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`
  are blanked. Claude also gets `--setting-sources project,local --strict-mcp-config` (no user
  hooks or MCP servers), Codex `--ignore-user-config`.
- Inside that sandbox each CLI runs with its own permission prompts off (Claude `dontAsk` with
  an explicit tool list, Codex `--dangerously-bypass-approvals-and-sandbox`, Gemini `--yolo`):
  nobody is there to answer, and nested sandboxes are unreliable. The bwrap boundary replaces them.
- The network is not cut: the CLI needs its API and the practice service on localhost. "No web
  search" stays a rule in the prompt; Claude's web tools are also disabled.
- `ddk/PROMPT_LAUNCH.md` is the short launch prompt (read TASK.md, rules, run unattended, stop if
  the practice service is unreachable). It is the same for every CLI.
- Manifests record token usage from each CLI's JSON output (Claude also gives a cost), wall time,
  practice runs and the outcome (ok, timeout, CLI exit code). Logs, practice runs and the final
  driver stay in `results/<name>/<slug>/build/`.
- `--check` validates the sandbox, the practice service and each CLI without running a model.
- Gemini has no model ids in `models.json` yet: the Gemini CLI is not installed here and current
  ids could not be confirmed.

## D19. Practise on three circuits, race on an unseen one (2026-11-09)

- Models practise on `monaco`, `silverstone` and `portimao` and the event runs on `barcelona`,
  which no workspace contains. `TASK.md` (`agentic-0.3`) says the event circuit is none of the
  practice ones. D17 showed why: a driver tuned to the event circuit wins there and crashes
  elsewhere.
- The practice budget is 10 runs, shared across circuits; the model picks the circuit per run
  (`bench.mjs practice --track`). This supersedes D16's 5.
- A token lists its circuits, and the service refuses any other one, so a model cannot practise
  on the event circuit through the API either. `build-drivers.sh` refuses an event track that is
  also a practice track.
- Known limits: three real circuits are little to generalise from, Barcelona is a public
  circuit the models may know, and the house driver crashes on the real circuits, so the
  gap to reference is empty there.

## D20. Builds have a known time limit and keep a tested driver (2026-11-09)

- Each model gets 30 minutes by default (`--timeout <min>`), and the launch prompt states the
  limit and the end time. Before this the CLI was cut off at a limit the model did not know.
- The prompt asks the model to keep `driver.js` at its best tested version. If a model is cut
  off anyway and its `driver.js` never completed a clean practice run, the script submits the
  newest driver that did (`runs/NNN/driver.js`); the manifest records `driverSource`.
- All models run in parallel by default: practice runs are about 3 s and the service queues them.
- Workspaces are created one at a time before any model starts, because each registers its token
  by rewriting `results/agentic/tokens.json`; concurrent registrations lost a token in the first
  build. Ctrl-C now stops every model run, not only the script.

## D21. Reasoning effort is set explicitly, medium by default (2026-11-09)

- `models.json` has `"effort": "medium"`; an entry may override it and `--effort` overrides all.
  It goes to `claude --effort` and to Codex as `-c model_reasoning_effort=…`, and the manifest
  records it. The Gemini CLI has no such flag.
- Before this, `gp-1` ran at whatever each CLI defaulted to: the script skips the owner's user
  settings, so the Claude models ran at the CLI default and Codex at each model's own default
  (Sol and Luna medium, Terra and Astra low). Its manifests record that.

## D22. The TV camera is one overhead shot that never cuts (2026-11-09)

- The owner's reference is an overhead qualifying-lap comparison: a single camera straight down
  on the cars, telephoto, rotating slowly after the direction of travel so a corner shows the car
  turning on screen while the frame catches up. TV mode now does only that; the heli and
  trackside shots, the cuts between them and the trackside camera placement are gone.
- Zoom follows the traffic: the frame holds the focused car plus the nearest cars that fit within
  `TV_MAX_SPAN` metres (`apps/viewer/src/lib/camera.ts`, the owner's knob), and is tightest
  (`TV_MIN_SPAN`) alone. A car joins below 85% of the max and leaves above it, so one hovering at
  the limit does not pump the zoom.
- There is no auto-director any more: the TV camera stays on one car (the `?car=` one, else the
  first) and changes only when the viewer picks another in the timing tower or with Tab / [ ].
  The change pans to the new car; it does not cut.
- A live zoom factor (slider in the control bar in TV mode, mouse wheel over the view, Z / X,
  `?zoom=` in the URL) divides both spans, so it also changes the solo framing. It is clamped to
  0.4–2.8×; the constants above stay the defaults at 1×.

## D23. The house driver is out of generated races unless asked for (2026-11-09)

- The owner does not want it on the grid: it is far off the pace and crashes on the real
  circuits, so it only clutters the replay and the tower. `event run` and `make race` no longer
  add it; `--reference` still does, for `race`, `qualify` and `event run`.
- `event-results.json` records `reference`. Without it there is no reference lap, so the event
  table drops its "Gap to ref" column. `event reproduce` re-runs with whatever the stored event
  used, and results written before the field existed count as having run it, which they did.

## D24. The viewer's car is an imported low-poly model, fitted to 2026 proportions (2026-11-09)

- The procedural open-wheeler is replaced by the owner's STL (`cars/sources/f1-car-low-poly.stl`,
  12.6k triangles). `scripts/import-car.ts` splits it into its connected parts, assigns each a
  role (painted body, carbon/white detail, front upright) and decimates them with meshoptimizer
  into `apps/viewer/src/lib/car-model.gen.json`. Only the right upright is stored; the left one
  is mirrored.
- Decimation: an absolute error of 0.01 source units (about 5 mm on the car) keeps 45% of the
  triangles and is indistinguishable from the source in the viewer; at 0.02 curved parts turn
  visibly polygonal. Re-run the script with `--error` to trade again. A whole car is about 5.4k
  triangles.
- The STL's wheels are dropped and rebuilt in `apps/viewer/src/lib/carparts.ts`: they are
  sculpted rather than turned (the tyre is not round, and the hub disc sits about 1 cm off the
  axle), so they wobbled when spun. The importer measures them (tyre radius by a circle fit,
  width, rim and cover radii); the viewer turns a tyre, rim, cover and nut about the axle from
  those, with five marks on the cover so rotation reads on screen.
- Its rear wing is dropped too and rebuilt to the 2026 rules: three elements, no beam wing, plain
  endplates rounded at the top, and two pylons into the underside of the mainplane. Mainplane
  and pylons are carbon; flaps and endplates take the car's colour.
- The source's proportions are off (wheels a quarter too large, the body tall and long), so it is
  fitted, not scaled uniformly, to the replay's car: the axles land on the sim's wheelbase, the
  overhangs are scaled to the overall length, width sets the lateral scale, and the tyre radius
  is that of a 2026 car relative to its wheelbase (about 710 mm on 3.4 m). The body is scaled
  vertically so the suspension meets the hubs, which leaves it about 12% taller than a real car;
  the wing is raised by the same ratio so it sits level with the roll hoop. The sim's own car
  (`cars/proto.json`) is unchanged.

## D25. A design system for the viewer, the results pages and the video (2026-11-09)

- The inherited HUD style is replaced by the Grand Prompt design system. It lives in code, in `packages/ui`:
  tokens, `components.css` and the React components. The brand book, component guides and screens stay in the
  owner's design system and canvas on claude.ai; a copy in the repository would only drift. `tokens.json` is
  the one source for colours, type, spacing and motion; `make tokens` generates `tokens.gen.css` and
  `src/tokens.gen.ts`, and tests fail while they are stale or when a contrast floor breaks (text 4.5:1 on
  every surface, entry colours 3:1 on every ground).
- Dark only. The chrome is ink and chalk; hue belongs to entries and to a short list of signals (fastest lap,
  DNF, warning, delta). The red accent is gone, partly because it read as a series colour.
- A car is an entry (`resolveEntries` in `@bench/ui`): a three-letter code from the model's given name, one
  of twelve colour slots tuned to stay apart under protanopia, deuteranopia and tritanopia (the code carries
  slots 9 to 12), and a provider that picks the body paint. The entry colour goes on labels, trails, the
  tower, the map and charts; the body shows the provider. Replays do not carry slots yet, so the viewer
  resolves them in id order and ignores the stored colour; `models.json` slots come with the publish step.
- Type is Archivo (variable width and weight; expanded for titles, condensed for numbers) and JetBrains Mono,
  both OFL, shipped in `packages/ui/fonts`.
- The redesign was planned in six phases (foundations, desktop HUD, ghost start, incidents, classification and
  analysis, phone); the owner asked for the replay viewer as one pull request instead of commits on `main`.
  The ghost start (issue 1) follows option A plus B: translucent packs, a pack label and a start board, never a
  moved car; a test checks that every car is drawn at its replay sample.
- Words come from the data, so the same replay always says the same thing: corners are numbered from the line
  by curvature (`lib/corners.ts`), and an incident sentence is built from the car's frames (spin onset, coming
  to rest, wrong-way driving, rejoining, how it ended; `lib/incidents.ts`).
- Build cost is what the CLI reported, or tokens × list price from the committed `prices.json`, marked as an
  estimate (an upper bound: no cache discount). `prices.json` starts empty; an estimate needs a dated price.
- The points column (10-8-6-5-4-3-2-1) is display only, the design's proposal, until season standings exist.
