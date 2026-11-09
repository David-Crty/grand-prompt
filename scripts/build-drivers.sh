#!/usr/bin/env bash
# Build one driver per model listed in models.json, each written by the model's own coding CLI
# (claude, codex, gemini) running unattended in a bubblewrap sandbox that only sees its workspace.
#
#   scripts/build-drivers.sh <name> [options]
#
# Output: drivers/<name>/<model-slug>/{driver.js,manifest.json}, plus results/<name>/event.json
# so that `pnpm bench event run <name>` races them, on a circuit none of them practised on.
# Logs go to results/<name>/<slug>/build/.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: scripts/build-drivers.sh <name> [options]

  --practice-tracks <a,b,c>   circuits the models may practise on (default monaco,silverstone,portimao)
  --event-track <id>  circuit of the event, never shown in practice (default barcelona)
  --laps <n>          race laps written to the event config (default 5)
  --budget <n>        practice runs per model, shared across circuits (default: bench workspace default)
  --jobs <n>          models built in parallel (default 0: all at once)
  --timeout <min>     wall-time limit per model in minutes, told to the model (default 30)
  --only <list>       comma-separated providers or model ids to build (default: all)
  --models <file>     model list (default models.json)
  --port <n>          practice service port (default 8787; an already running service is reused)
  --dry-run           print what would run, start nothing
  --check             check the sandbox, the practice service and each CLI without running a model
EOF
}

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NAME="${1:-}"
[[ -z "$NAME" || "$NAME" == -* ]] && { usage; exit 2; }
shift
PRACTICE=monaco,silverstone,portimao EVENT_TRACK=barcelona LAPS=5 BUDGET="" JOBS=0 TIMEOUT=30 ONLY="" MODELS="$REPO/models.json" PORT=8787 DRY=0 CHECK=0
while (($#)); do
  case "$1" in
    --practice-tracks) PRACTICE=$2; shift 2 ;;
    --event-track) EVENT_TRACK=$2; shift 2 ;;
    --laps) LAPS=$2; shift 2 ;;
    --budget) BUDGET=$2; shift 2 ;;
    --jobs) JOBS=$2; shift 2 ;;
    --timeout) TIMEOUT=$2; shift 2 ;;
    --only) ONLY=$2; shift 2 ;;
    --models) MODELS=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --check) CHECK=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

[[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "name must be lowercase letters, digits and dashes: '$NAME'"
IFS=, read -ra practice_list <<<"$PRACTICE"
for t in "${practice_list[@]}" "$EVENT_TRACK"; do
  [[ -f "$REPO/tracks/$t.json" ]] || die "unknown track '$t' (see: pnpm bench tracks)"
done
for t in "${practice_list[@]}"; do
  [[ "$t" == "$EVENT_TRACK" ]] && die "the event track '$EVENT_TRACK' must not be a practice track"
done
[[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] || die "--timeout is a number of minutes: '$TIMEOUT'"
[[ "$JOBS" =~ ^[0-9]+$ ]] || die "--jobs is a number: '$JOBS'"
[[ -f "$MODELS" ]] || die "no model list at $MODELS"
for c in jq bwrap curl node pnpm; do command -v "$c" >/dev/null || die "$c is required"; done

OUT="$REPO/drivers/$NAME"
RES="$REPO/results/$NAME"
URL="http://127.0.0.1:$PORT"
PROMPT_TEMPLATE=$(cat "$REPO/ddk/PROMPT_LAUNCH.md")
PROMPT_VERSION=$(sed -n 's/.*prompt version: \([^ ]*\).*/\1/p' "$REPO/ddk/PROMPT_AGENTIC.md" | head -1)
BASELINE="$REPO/ddk/baseline-driver.js"
versions=$(cd "$REPO" && node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const v = readFileSync("packages/sim/src/version.ts", "utf8");
  const get = (k) => v.match(new RegExp(k + ` = "([^"]+)"`))[1];
  console.log(get("SIM_VERSION"), get("DDK_VERSION"));')
read -r SIM_VERSION DDK_VERSION <<<"$versions"

slugify() { tr '[:upper:]' '[:lower:]' <<<"$1" | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+|-+$//g'; }

wanted() { # provider id
  [[ -z "$ONLY" ]] && return 0
  local IFS=,
  for w in $ONLY; do [[ "$w" == "$1" || "$w" == "$2" ]] && return 0; done
  return 1
}

cli_for() {
  case "$1" in
    claude) echo claude ;;
    codex) echo codex ;;
    gemini) echo gemini ;;
    *) return 1 ;;
  esac
}

provider_org() {
  case "$1" in
    claude) echo anthropic ;;
    codex) echo openai ;;
    gemini) echo google ;;
  esac
}

# The sandbox: the whole filesystem read-only, the repo and every other workspace hidden, the
# model's workspace mounted read-write at /tmp/ws, and the CLI's own state dirs writable so it
# can authenticate. Session histories are replaced by empty tmpfs: they hold earlier transcripts,
# including other models' drivers. The host network stays: the CLI needs its API and the
# practice service on localhost.
sandbox_args() { # workspace
  local ws=$1 a=(--ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --die-with-parent)
  a+=(--tmpfs "$REPO")
  [[ -d "$HOME/Codes" ]] && a+=(--tmpfs "$HOME/Codes")
  [[ -d "$HOME/bench-ws" ]] && a+=(--tmpfs "$HOME/bench-ws")
  local d
  for d in "$HOME/.claude" "$HOME/.codex" "$HOME/.gemini" "$HOME/.cache" "$HOME/.local/state" "$HOME/.npm"; do
    [[ -d "$d" ]] && a+=(--bind "$d" "$d")
  done
  [[ -f "$HOME/.claude.json" ]] && a+=(--bind "$HOME/.claude.json" "$HOME/.claude.json")
  for d in "$HOME/.claude/projects" "$HOME/.claude/agents" "$HOME/.claude/skills" "$HOME/.claude/commands" \
    "$HOME/.codex/sessions" "$HOME/.codex/memories" "$HOME/.gemini/tmp" "$HOME/.gemini/history"; do
    [[ -d "$d" ]] && a+=(--tmpfs "$d")
  done
  local f
  for f in "$HOME/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md" "$HOME/.gemini/GEMINI.md"; do
    [[ -f "$f" ]] && a+=(--ro-bind /dev/null "$f")
  done
  a+=(--dir /tmp/ws --bind "$ws" /tmp/ws --chdir /tmp/ws)
  printf '%s\0' "${a[@]}"
}

# The command a provider's CLI runs inside the sandbox. Each runs with its own permission
# prompts off: nobody is there to answer them, and the bubblewrap sandbox is the boundary.
cli_cmd() { # provider model
  case "$1" in
    claude)
      printf '%s\0' claude -p "$PROMPT" --model "$2" --output-format json \
        --setting-sources project,local --strict-mcp-config \
        --permission-mode dontAsk --allowedTools Read Edit Write Bash Glob Grep \
        --disallowedTools WebSearch WebFetch Agent
      ;;
    codex)
      printf '%s\0' codex exec --json --skip-git-repo-check --ephemeral --ignore-user-config \
        --dangerously-bypass-approvals-and-sandbox -m "$2" "$PROMPT"
      ;;
    gemini)
      printf '%s\0' gemini -p "$PROMPT" -m "$2" --output-format json --yolo
      ;;
  esac
}

# Usage numbers from each CLI's machine-readable output, as a JSON object (fields may be null).
usage_json() { # provider out-file
  local u
  u=$(usage_json_raw "$@" 2>/dev/null) || u=""
  [[ -n "$u" ]] && echo "$u" || echo '{}'
}

usage_json_raw() { # provider out-file
  case "$1" in
    claude)
      jq -c '{inputTokens: ((.usage.input_tokens // 0) + (.usage.cache_read_input_tokens // 0)
                + (.usage.cache_creation_input_tokens // 0)),
              outputTokens: .usage.output_tokens, costUsd: .total_cost_usd, turns: .num_turns,
              error: (if .is_error then (.result // "error") else null end)}' "$2" 2>/dev/null
      ;;
    codex)
      jq -sc '[.[] | select(.type == "turn.completed") | .usage] |
              {inputTokens: (map(.input_tokens // 0) | add), outputTokens: (map(.output_tokens // 0) | add),
               costUsd: null, turns: length, error: null}' "$2" 2>/dev/null
      ;;
    gemini)
      jq -c '{inputTokens: ([.stats.models[]?.tokens.prompt // 0] | add),
              outputTokens: ([.stats.models[]?.tokens.candidates // 0] | add),
              costUsd: null, turns: null, error: (.error.message // null)}' "$2" 2>/dev/null
      ;;
  esac
}

# Workspaces are created one at a time, before any model runs: each registers its token by
# rewriting results/agentic/tokens.json, so concurrent registrations would drop each other.
make_workspace() { # id
  local slug ws logs
  slug=$(slugify "$1")
  ws="$WS_ROOT/$slug"
  logs="$RES/$slug/build"
  mkdir -p "$logs"
  local wsargs=(--model "$slug" --track "$PRACTICE" --service-url "$URL")
  [[ -n "$BUDGET" ]] && wsargs+=(--budget "$BUDGET")
  (cd "$REPO" && pnpm -s bench workspace "$ws" "${wsargs[@]}") >"$logs/workspace.txt" 2>&1 ||
    die "$slug: workspace failed, see $logs/workspace.txt"
}

# The newest practice run that finished cleanly (no crash, off-track or ECU strike), as its
# runs/NNN directory, or nothing.
last_clean_run() { # workspace
  local r
  for r in $(ls -d "$1"/runs/*/ 2>/dev/null | sort -r); do
    jq -e '.result | .status == "FINISHED" and .offTracks == 0 and .strikes == 0' "$r/summary.json" \
      >/dev/null 2>&1 && [[ -f "$r/driver.js" ]] && { echo "${r%/}"; return; }
  done
}

# True if the file is byte-identical to the driver of some clean practice run.
is_clean_tested() { # workspace file
  local r
  for r in "$1"/runs/*/; do
    [[ -f "$r/driver.js" ]] && cmp -s "$2" "$r/driver.js" &&
      jq -e '.result | .status == "FINISHED" and .offTracks == 0 and .strikes == 0' "$r/summary.json" \
        >/dev/null 2>&1 && return 0
  done
  return 1
}

build_one() { # provider id name
  local provider=$1 id=$2 name=$3 slug ws logs start end deadline
  slug=$(slugify "$id")
  ws="$WS_ROOT/$slug"
  logs="$RES/$slug/build"

  deadline=$(date -d "+$TIMEOUT min" +%H:%M)
  local PROMPT=${PROMPT_TEMPLATE//'{{TIME_LIMIT}}'/$TIMEOUT}
  PROMPT=${PROMPT//'{{DEADLINE}}'/$deadline}
  printf '%s\n' "$PROMPT" >"$logs/prompt.txt"
  local sb=() cmd=()
  mapfile -d '' sb < <(sandbox_args "$ws")
  mapfile -d '' cmd < <(cli_cmd "$provider" "$id")
  log "$slug: started ($provider, until $deadline)"
  start=$(date +%s)
  local code=0
  timeout --kill-after=30s "${TIMEOUT}m" bwrap "${sb[@]}" "${cmd[@]}" </dev/null >"$logs/output.json" 2>"$logs/stderr.txt" &
  echo $! >"$WS_ROOT/$slug.pid"
  wait $! || code=$?
  end=$(date +%s)

  local status runs=null
  status=$(cd "$ws" && node bench.mjs status 2>&1) || true
  [[ "$status" =~ used\ ([0-9]+)\ of ]] && runs=${BASH_REMATCH[1]}
  cp -r "$ws/runs" "$logs/runs" 2>/dev/null || true
  cp "$ws/driver.js" "$logs/driver.js" 2>/dev/null || true

  local outcome=ok
  ((code == 124 || code == 137)) && outcome=timeout
  ((code != 0 && code != 124 && code != 137)) && outcome="cli exit $code"
  if [[ ! -s "$ws/driver.js" ]] || cmp -s "$ws/driver.js" "$BASELINE"; then
    log "$slug: no driver written ($outcome, $((end - start)) s), skipped; see $logs/"
    return 0
  fi

  # A model cut off by the time limit may leave a half-edited driver.js: fall back to the newest
  # driver that completed a clean practice run, unless driver.js is itself one of those.
  local source=driver.js clean
  if [[ "$outcome" != ok ]] && ! is_clean_tested "$ws" "$ws/driver.js"; then
    clean=$(last_clean_run "$ws")
    [[ -n "$clean" ]] && source="runs/$(basename "$clean")/driver.js"
  fi
  mkdir -p "$OUT/$slug"
  cp "$ws/$source" "$OUT/$slug/driver.js"
  jq -n --arg model "$name" --arg id "$id" --arg provider "$(provider_org "$provider")" --arg cli "$provider" \
    --arg pv "$PROMPT_VERSION" --arg ddk "$DDK_VERSION" --arg sim "$SIM_VERSION" --arg outcome "$outcome" --arg source "$source" \
    --arg practice "$PRACTICE" --arg event "$EVENT_TRACK" --arg timeout "$TIMEOUT" --argjson runs "$runs" --argjson wall $((end - start)) \
    --argjson u "$(usage_json "$provider" "$logs/output.json")" '{
      model: $model, provider: $provider, mode: "agentic", promptVersion: $pv, ddkVersion: $ddk, simVersion: $sim,
      usage: ({inputTokens: $u.inputTokens, outputTokens: $u.outputTokens, costUsd: $u.costUsd,
               wallTimeS: $wall, practiceRuns: $runs} | with_entries(select(.value != null))),
      settings: {modelId: $id, cli: $cli, practiceTracks: ($practice | split(",")), eventTrack: $event, sandbox: "bubblewrap", timeLimitMin: ($timeout | tonumber), outcome: $outcome, driverSource: $source,
                 turns: $u.turns, cliError: $u.error}
    }' >"$OUT/$slug/manifest.json"
  log "$slug: done ($outcome, $((end - start)) s, $runs practice runs, driver from $source)"
}

# --- plan --------------------------------------------------------------------------------------
plan=()
skipped=()
for provider in $(jq -r 'keys_unsorted[]' "$MODELS"); do
  cli=$(cli_for "$provider") || die "unknown provider '$provider' in $MODELS (claude, codex, gemini)"
  while IFS=$'\t' read -r id name; do
    [[ -z "$id" ]] && continue
    wanted "$provider" "$id" || continue
    if ! command -v "$cli" >/dev/null; then
      skipped+=("$id ($cli not installed)")
      continue
    fi
    ((CHECK)) || [[ ! -e "$OUT/$(slugify "$id")" ]] || die "$OUT/$(slugify "$id") already exists; pick another name or remove it"
    plan+=("$provider"$'\t'"$id"$'\t'"$name")
  done < <(jq -r --arg p "$provider" '.[$p][] | [.id, (.name // .id)] | @tsv' "$MODELS")
done
((${#skipped[@]})) && printf 'skipping %s\n' "${skipped[@]}"
((${#plan[@]})) || die "nothing to build"

((JOBS == 0)) && JOBS=${#plan[@]}
echo "building ${#plan[@]} drivers into drivers/$NAME/ (practice on $PRACTICE, event on $EVENT_TRACK), $JOBS at a time, $TIMEOUT min each:"
printf '  %s\n' "${plan[@]//$'\t'/  }"
if ((DRY)); then
  ws=/tmp/example
  mapfile -d '' sb < <(sandbox_args "$ws")
  IFS=$'\t' read -r p i _ <<<"${plan[0]}"
  mapfile -d '' cmd < <(cli_cmd "$p" "$i")
  echo "sandbox for the first model:"
  printf ' %q' bwrap "${sb[@]}" "${cmd[@]:0:3}"
  echo ' ...'
  exit 0
fi

# --- run ---------------------------------------------------------------------------------------
((CHECK)) || mkdir -p "$RES" "$OUT"
if ((!CHECK)) && [[ ! -f "$RES/event.json" ]]; then
  jq -n --arg id "$NAME" --arg track "$EVENT_TRACK" --argjson laps "$LAPS" \
    '{id: $id, name: $id, track: $track, qualifyAttempts: 1, raceLaps: $laps, seed: 2026, infoLevel: "B"}' \
    >"$RES/event.json"
fi

WS_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/bench-build-$NAME.XXXX")
SERVE_PID=""
builders=()
cleanup() {
  local f
  for f in "$WS_ROOT"/*.pid; do [[ -f "$f" ]] && kill -TERM "$(cat "$f")" 2>/dev/null; done
  ((${#builders[@]})) && wait "${builders[@]}" 2>/dev/null || true
  [[ -n "$SERVE_PID" ]] && kill -- "-$SERVE_PID" 2>/dev/null || true
  rm -rf "$WS_ROOT"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if curl -s -m 2 "$URL/status" >/dev/null; then
  log "reusing the practice service on $URL"
else
  SERVE_LOG="$RES/serve.log"
  ((CHECK)) && SERVE_LOG="$WS_ROOT/serve.log"
  (cd "$REPO" && exec setsid pnpm -s bench serve --port "$PORT") >"$SERVE_LOG" 2>&1 &
  SERVE_PID=$!
  for _ in $(seq 60); do curl -s -m 1 "$URL/status" >/dev/null && break; sleep 0.5; done
  curl -s -m 2 "$URL/status" >/dev/null || die "practice service did not start: $(tail -3 "$SERVE_LOG")"
  log "practice service on $URL"
fi

if ((CHECK)); then
  declare -A seen=()
  fail=0
  for entry in "${plan[@]}"; do
    IFS=$'\t' read -r p i _ <<<"$entry"
    [[ -n "${seen[$p]:-}" ]] && continue
    seen[$p]=1
    ws="$WS_ROOT/check-$p"
    (cd "$REPO" && pnpm -s bench workspace "$ws" --model "check-$p" --track "$PRACTICE" --service-url "$URL" --budget 1) >/dev/null 2>&1
    mapfile -d '' sb < <(sandbox_args "$ws")
    cli=$(cli_for "$p")
    if bwrap "${sb[@]}" bash -c '
        set -e
        [[ -z "$(ls -A "$1" 2>/dev/null)" ]] || { echo "repo visible"; exit 1; }
        [[ ! -s "$HOME/.claude/CLAUDE.md" ]] || { echo "user CLAUDE.md visible"; exit 1; }
        [[ -z "$(ls -A "$HOME/.claude/projects" 2>/dev/null)" ]] || { echo "session history visible"; exit 1; }
        ! touch "$HOME/.build-drivers-probe" 2>/dev/null || { rm -f "$HOME/.build-drivers-probe"; echo "home writable"; exit 1; }
        [[ -f TASK.md ]] || { echo "workspace missing"; exit 1; }
        node bench.mjs status >/dev/null || { echo "practice service unreachable"; exit 1; }
        "$2" --version >/dev/null 2>&1 || { echo "$2 --version failed"; exit 1; }
      ' _ "$REPO" "$cli" >"$WS_ROOT/check-$p.txt" 2>&1; then
      log "check $p: ok (repo hidden, practice service reachable, $cli runs)"
    else
      log "check $p: FAILED: $(tail -1 "$WS_ROOT/check-$p.txt")"
      fail=1
    fi
  done
  exit "$fail"
fi

for entry in "${plan[@]}"; do
  IFS=$'\t' read -r _ i _ <<<"$entry"
  make_workspace "$i"
done
for entry in "${plan[@]}"; do
  IFS=$'\t' read -r _ i _ <<<"$entry"
  (cd "$WS_ROOT/$(slugify "$i")" && node bench.mjs status >/dev/null 2>&1) ||
    die "$(slugify "$i"): the practice service does not know its token"
done
log "${#plan[@]} workspaces ready"


for entry in "${plan[@]}"; do
  while ((${#builders[@]} >= JOBS)); do
    wait -n "${builders[@]}" || true
    alive=()
    for b in "${builders[@]}"; do kill -0 "$b" 2>/dev/null && alive+=("$b"); done
    builders=("${alive[@]}")
  done
  IFS=$'\t' read -r p i n <<<"$entry"
  build_one "$p" "$i" "$n" &
  builders+=($!)
done
((${#builders[@]})) && wait "${builders[@]}"

echo
echo "drivers in drivers/$NAME/:"
for d in "$OUT"/*/; do [[ -d "$d" ]] && echo "  $(basename "$d")"; done
echo "race them: pnpm bench event run $NAME"
