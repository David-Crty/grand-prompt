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
