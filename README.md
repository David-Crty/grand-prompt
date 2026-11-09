# F1 LLM Bench (working title)

A motorsport benchmark for LLMs. Each model writes a driving program once; then every program
races the same open-wheel car on the same circuit, in a deterministic simulator. Results are
replayed in 3D. See [PLAN.md](PLAN.md) for the goals and [docs/DECISIONS.md](docs/DECISIONS.md)
for what was decided along the way.

## Quick start

```bash
pnpm install
pnpm bench validate ddk/baseline-driver.js
pnpm bench practice ddk/baseline-driver.js --laps 3          # telemetry.csv, summary.json, replay
pnpm bench race ddk/baseline-driver.js --reference --laps 3  # vs. the house reference driver
pnpm --filter @bench/viewer dev                              # 3D replay viewer
```

Run `pnpm bench --help` for every command.

## Layout

| path | what |
|---|---|
| `packages/sim` | headless deterministic simulator: track model, vehicle physics, race control, replays |
| `packages/sandbox` | QuickJS sandbox for untrusted driver code: deterministic compute budgets, no host APIs |
| `packages/cli` | `bench`: validate, practice, qualify, race, events, leaderboard, practice service, one-shot runner |
| `packages/reference-driver` | internal house driver (racing line + speed profile + pure pursuit); never in the DDK |
| `apps/viewer` | 3D replay viewer (Vite + React Three Fiber) |
| `ddk/` | Driver Development Kit: what an LLM receives (spec, types, baseline, prompts, practice client) |
| `tracks/`, `cars/` | track and car data (`scripts/gen-proto-ring.ts` generates the Prototype Ring) |
| `drivers/<event>/<model>/driver.js` | submissions |
| `results/<event>/` | `event.json`, manifests, qualifying/race replays, `event-results.json` |
| `docs/` | DECISIONS, PHYSICS, REPLAY_FORMAT, TRACK_FORMAT |

## Running a benchmark event

```bash
# 1. the event config: results/<event>/event.json (see results/proto-gp-1/event.json)
# 2. one-shot submissions through OpenRouter. ~/.config/op-env/openrouter.env holds
#    OPENROUTER_API_KEY=op://<vault>/<item>/<field> (create it once)
op run --env-file=$HOME/.config/op-env/openrouter.env -- \
  pnpm bench oneshot proto-gp-1 --model <openrouter-model-id>
pnpm bench oneshot proto-gp-1 --prompt-only > /tmp/prompt.md   # inspect the exact prompt

# 3. agentic submissions: start the practice service, create an isolated workspace per model
pnpm bench serve --port 8787 &
pnpm bench workspace /tmp/ws-model-x --model model-x --budget 20
#    run the agent CLI inside /tmp/ws-model-x with TASK.md as its prompt, then copy
#    driver.js to drivers/proto-gp-1/model-x/ and write results/proto-gp-1/model-x/manifest.json

# 4. qualifying + race (house reference included), then verify and aggregate
pnpm bench event run proto-gp-1
pnpm bench event reproduce proto-gp-1     # re-runs and checks every state hash
pnpm bench leaderboard results
```

## Quality gates

```bash
pnpm lint && pnpm typecheck
pnpm coverage        # unit + feature tests; fails below 90% lines/branches/functions/statements
pnpm determinism     # same race in two processes, same hash
```

CI (`.github/workflows/ci.yml`) runs all of the above, plus the viewer build.
