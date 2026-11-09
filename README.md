# F1 LLM Bench (working title)

A motorsport benchmark for LLMs. Each model writes a driving program; then every program races
the same open-wheel car in a deterministic simulator, and the race is replayed in 3D. See
[PLAN.md](PLAN.md) for the goals and [docs/DECISIONS.md](docs/DECISIONS.md) for what was decided
along the way.

## Quick start

```shellscript
pnpm install
pnpm bench validate ddk/baseline-driver.js
pnpm bench practice ddk/baseline-driver.js --laps 3 --track monaco   # telemetry.csv, summary.json, replay
pnpm bench race drivers/proto-gp-1/*/driver.js --track barcelona --laps 5
pnpm --filter @bench/viewer dev     # http://localhost:5173/ lists every replay under results/
```

Run `pnpm bench --help` for every command and `pnpm bench tracks` for the circuits. `make` lists
shortcuts for the common ones: `make gates`, `make dev`, `make build NAME=gp-1`,
`make event NAME=gp-1`, `make race NAME=gp-1 TRACK=monaco`.

## Building drivers with LLMs

`scripts/build-drivers.sh <name>` builds one driver per model in [models.json](models.json), each
written by that vendor's coding CLI running unattended (`claude -p`, `codex exec`, `gemini -p`)
on your own subscription. No API key or OpenRouter account is needed.

```shellscript
scripts/build-drivers.sh my-gp --check                   # sandbox, practice service, CLIs; no model runs
scripts/build-drivers.sh my-gp                           # every model, in parallel
scripts/build-drivers.sh my-gp --only claude-haiku-5-5   # one model (or a provider: --only codex)
pnpm bench event run my-gp                               # qualifying + race on the event circuit
```

- Each model practises on Monaco, Silverstone and Portimão with 10 runs shared across them. The
  event runs on Barcelona, which no model sees, and the prompt says so (D19).
- Each model has 30 minutes and is told its deadline; if it is cut off, its last driver that
  completed a clean practice run is submitted (D20).
- Each CLI runs in a bubblewrap sandbox: the repo and other workspaces are hidden and only its
  own workspace is writable (D18).
- Output: `drivers/<name>/<model>/{driver.js,manifest.json}` (tokens, cost, wall time, practice
  runs, outcome) and `results/<name>/event.json`. Build logs stay in `results/<name>/<model>/build/`.
- Reasoning effort is `medium` for every model (`"effort"` in `models.json`, per model or for all;
  `--effort` overrides it) (D21).
- Options: `--practice-tracks a,b,c`, `--event-track id`, `--budget n`, `--timeout min`, `--effort level`,
  `--jobs n`, `--laps n`, `--dry-run`. Requires `bwrap`, `jq` and the CLIs, logged in.
- Don't edit the script while a build is running: bash reads it from disk as it goes.

By hand: `pnpm bench serve`, then `pnpm bench workspace <dir> --model <slug> --track a,b,c`, run
an agent in `<dir>` with `ddk/PROMPT_LAUNCH.md` as its prompt, and copy its `driver.js` to
`drivers/<event>/<slug>/`. One-shot submissions through OpenRouter (`pnpm bench oneshot`) still
exist but are unused.

## Events

```shellscript
pnpm bench event run proto-gp-1          # config: results/<event>/event.json
pnpm bench event reproduce proto-gp-1    # re-runs and checks every state hash
pnpm bench leaderboard results
```

## Layout

| path                                | what                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/sim`                      | headless deterministic simulator: track model, vehicle physics, race control, replays   |
| `packages/sandbox`                  | QuickJS sandbox for untrusted driver code: deterministic compute budgets, no host APIs  |
| `packages/cli`                      | `bench`: validate, practice, qualify, race, events, leaderboard, practice service       |
| `packages/reference-driver`         | internal house driver; never in the DDK                                                 |
| `apps/viewer`                       | 3D replay viewer (Vite + React Three Fiber)                                             |
| `ddk/`                              | Driver Development Kit: what an LLM receives (spec, types, baseline, prompts, client)  |
| `models.json`, `scripts/build-drivers.sh` | the models to build and the build script                                          |
| `tracks/`, `cars/`                  | circuits (`proto-ring` generated, the real ones imported from `tracks/sources/`) and car |
| `drivers/<event>/<model>/`          | submissions: `driver.js` and `manifest.json`                                            |
| `results/<event>/`                  | `event.json` (committed), replays, `event-results.json`, build logs (not committed)     |
| `docs/`                             | DECISIONS, PHYSICS, REPLAY_FORMAT, TRACK_FORMAT                                         |

## Quality gates

```shellscript
pnpm lint && pnpm typecheck
pnpm coverage        # unit + feature tests; fails below 90% lines/branches/functions/statements
pnpm determinism     # same race in two processes, same hash
pnpm --filter @bench/viewer build
```

CI (`.github/workflows/ci.yml`) runs all of the above.
