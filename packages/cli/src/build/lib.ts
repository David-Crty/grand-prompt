import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Provider = "claude" | "codex" | "gemini";

export const PROVIDERS: Record<Provider, { cli: string; org: string }> = {
  claude: { cli: "claude", org: "anthropic" },
  codex: { cli: "codex", org: "openai" },
  gemini: { cli: "gemini", org: "google" },
};

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export interface BuildOptions {
  /** The event: drivers go to drivers/<name>/, logs to results/builds/<name>/. */
  name: string;
  practice: string[];
  /** Practice runs per model, shared across circuits (default: the workspace default). */
  budget: number | undefined;
  /** Models built in parallel; 0 is all at once. */
  jobs: number;
  /** Wall-time limit per model, minutes, stated in the prompt. */
  timeout: number;
  /** Providers or model ids to build; empty is all. */
  only: string[];
  models: string;
  effort: string | undefined;
  port: number;
  plain: boolean;
  dryRun: boolean;
  check: boolean;
}

export const BUILD_DEFAULTS = {
  practice: ["monaco", "silverstone", "portimao"],
  timeout: 30,
  port: 8787,
};

/** A whole number at least `min`, or undefined when the flag is absent. */
export function count(flag: string, v: string | undefined, min: number): number | undefined {
  if (v === undefined) return undefined;
  if (!/^[0-9]+$/.test(v) || Number(v) < min) throw new Error(`${flag} is a number ≥ ${min}: '${v}'`);
  return Number(v);
}

/** Validated build options from the command line's values. */
export function buildOptions(
  name: string | undefined,
  v: Record<string, string | boolean | undefined>,
  defaultModels: string,
): BuildOptions {
  if (!name) throw new Error("build: missing <name>");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new Error(`name must be lowercase letters, digits and dashes: '${name}'`);
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  const list = (k: string) => str(k)?.split(",").filter(Boolean);
  const o: BuildOptions = {
    name,
    practice: list("practice-tracks") ?? BUILD_DEFAULTS.practice,
    budget: count("--budget", str("budget"), 1),
    jobs: count("--jobs", str("jobs"), 0) ?? 0,
    timeout: count("--timeout", str("timeout"), 1) ?? BUILD_DEFAULTS.timeout,
    only: list("only") ?? [],
    models: str("models") ?? defaultModels,
    effort: str("effort"),
    port: count("--port", str("port"), 1) ?? BUILD_DEFAULTS.port,
    plain: v.plain === true,
    dryRun: v["dry-run"] === true,
    check: v.check === true,
  };
  return o;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface PlanEntry {
  provider: Provider;
  id: string;
  name: string;
  effort: string;
  slug: string;
}

interface ModelList {
  effort?: string;
  [provider: string]: unknown;
}

/** One entry per wanted model; models whose CLI is missing go to `skipped`. */
export function planBuilds(
  models: ModelList,
  opts: Pick<BuildOptions, "only" | "effort">,
  hasCli: (cli: string) => boolean,
): { plan: PlanEntry[]; skipped: string[] } {
  const fallback = opts.effort ?? models.effort ?? "medium";
  if (!EFFORTS.includes(fallback)) throw new Error(`unknown effort '${fallback}' (${EFFORTS.join(", ")})`);
  const plan: PlanEntry[] = [];
  const skipped: string[] = [];
  for (const [provider, list] of Object.entries(models)) {
    if (!Array.isArray(list)) continue;
    if (!(provider in PROVIDERS))
      throw new Error(`unknown provider '${provider}' in the model list (claude, codex, gemini)`);
    const { cli } = PROVIDERS[provider as Provider];
    for (const m of list as { id: string; name?: string; effort?: string }[]) {
      if (!m.id) continue;
      if (opts.only.length && !opts.only.includes(provider) && !opts.only.includes(m.id)) continue;
      if (!hasCli(cli)) {
        skipped.push(`${m.id} (${cli} not installed)`);
        continue;
      }
      const effort = opts.effort ?? m.effort ?? fallback;
      if (!EFFORTS.includes(effort)) throw new Error(`${m.id}: unknown effort '${effort}'`);
      plan.push({
        provider: provider as Provider,
        id: m.id,
        name: m.name ?? m.id,
        effort,
        slug: slugify(m.id),
      });
    }
  }
  return { plan, skipped };
}

/**
 * The sandbox: the whole filesystem read-only, the repo and every other workspace hidden, the
 * model's workspace mounted read-write at /tmp/ws, and the CLI's own state dirs writable so it
 * can authenticate. Session histories are replaced by empty tmpfs: they hold earlier transcripts,
 * including other models' drivers. The host network stays: the CLI needs its API and the
 * practice service on localhost.
 */
export function sandboxArgs(ws: string, repo: string, home: string): string[] {
  const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();
  const a = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--die-with-parent",
  ];
  a.push("--tmpfs", repo);
  for (const d of ["Codes", "bench-ws"]) if (isDir(join(home, d))) a.push("--tmpfs", join(home, d));
  for (const d of [".claude", ".codex", ".gemini", ".cache", ".local/state", ".npm"])
    if (isDir(join(home, d))) a.push("--bind", join(home, d), join(home, d));
  if (isFile(join(home, ".claude.json")))
    a.push("--bind", join(home, ".claude.json"), join(home, ".claude.json"));
  for (const d of [
    ".claude/projects",
    ".claude/agents",
    ".claude/skills",
    ".claude/commands",
    ".codex/sessions",
    ".codex/memories",
    ".gemini/tmp",
    ".gemini/history",
  ])
    if (isDir(join(home, d))) a.push("--tmpfs", join(home, d));
  for (const f of [".claude/CLAUDE.md", ".codex/AGENTS.md", ".gemini/GEMINI.md"])
    if (isFile(join(home, f))) a.push("--ro-bind", "/dev/null", join(home, f));
  a.push("--dir", "/tmp/ws", "--bind", ws, "/tmp/ws", "--chdir", "/tmp/ws");
  return a;
}

/**
 * The command a provider's CLI runs inside the sandbox. Each runs with its own permission
 * prompts off: nobody is there to answer them, and the bubblewrap sandbox is the boundary.
 * Claude and Codex stream JSON events, one per line, which feed the live view.
 */
export function cliCmd(provider: Provider, model: string, effort: string, prompt: string): string[] {
  switch (provider) {
    case "claude":
      return [
        "claude",
        "-p",
        prompt,
        "--model",
        model,
        "--effort",
        effort,
        "--output-format",
        "stream-json",
        "--verbose",
        "--setting-sources",
        "project,local",
        "--strict-mcp-config",
        "--permission-mode",
        "dontAsk",
        "--allowedTools",
        "Read",
        "Edit",
        "Write",
        "Bash",
        "Glob",
        "Grep",
        "--disallowedTools",
        "WebSearch",
        "WebFetch",
        "Agent",
      ];
    case "codex":
      return [
        "codex",
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "-c",
        `model_reasoning_effort="${effort}"`,
        "--dangerously-bypass-approvals-and-sandbox",
        "-m",
        model,
        prompt,
      ];
    case "gemini":
      return ["gemini", "-p", prompt, "-m", model, "--output-format", "json", "--yolo"];
  }
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  turns: number | null;
  error: string | null;
}

const NO_USAGE: Usage = { inputTokens: null, outputTokens: null, costUsd: null, turns: null, error: null };

function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object") out.push(v);
    } catch {}
  }
  return out;
}

// biome-ignore lint/suspicious/noExplicitAny: CLI output is untyped JSON
type Json = any;

const sum = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);

/** Usage numbers from a CLI's machine-readable output; fields it does not report are null. */
export function parseUsage(provider: Provider, text: string): Usage {
  const events: Json[] = jsonLines(text);
  if (provider === "claude") {
    // stream-json ends with a "result" event; plain json is that event alone.
    const r = [...events].reverse().find((e) => e.type === "result" || (e.usage && !e.type));
    if (!r) return NO_USAGE;
    const u = r.usage ?? {};
    return {
      inputTokens:
        (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? null,
      costUsd: r.total_cost_usd ?? null,
      turns: r.num_turns ?? null,
      error: r.is_error ? (r.result ?? "error") : null,
    };
  }
  if (provider === "codex") {
    if (!events.length) return NO_USAGE;
    const turns = events.filter((e) => e.type === "turn.completed").map((e) => e.usage ?? {});
    return {
      inputTokens: sum(turns.map((u) => u.input_tokens ?? 0)),
      outputTokens: sum(turns.map((u) => u.output_tokens ?? 0)),
      costUsd: null,
      turns: turns.length,
      error: null,
    };
  }
  const g = events[events.length - 1];
  if (!g) return NO_USAGE;
  const models = Object.values(g.stats?.models ?? {}) as Json[];
  return {
    inputTokens: sum(models.map((m) => m.tokens?.prompt ?? 0)),
    outputTokens: sum(models.map((m) => m.tokens?.candidates ?? 0)),
    costUsd: null,
    turns: null,
    error: g.error?.message ?? null,
  };
}

/** What one line of a CLI's event stream says the model is doing. */
export interface Activity {
  text: string;
  tool: boolean;
}

function firstLine(s: string): string {
  return (
    s
      .split("\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
      .map((l) => l.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
      .find(Boolean) ?? ""
  );
}

function shortPath(p: string): string {
  return p.startsWith("/tmp/ws/") ? p.slice(8) : p;
}

function describeTool(name: string, input: Json): string {
  if (!input || typeof input !== "object") return name;
  if (typeof input.command === "string") return `$ ${firstLine(input.command)}`;
  if (typeof input.file_path === "string") return `${name} ${shortPath(input.file_path)}`;
  if (typeof input.pattern === "string") return `${name} ${input.pattern}`;
  return name;
}

/** Strips the `/usr/bin/zsh -lc '…'` wrapper Codex puts around each command. */
export function unwrapShell(cmd: string): string {
  const m = cmd.match(/^\S*(?:ba|z)?sh -l?c '([\s\S]*)'$/);
  return m ? m[1]!.replace(/'\\''/g, "'") : cmd;
}

export function parseActivity(provider: Provider, line: string): Activity[] {
  let e: Json;
  try {
    e = JSON.parse(line);
  } catch {
    return [];
  }
  if (!e || typeof e !== "object") return [];
  if (provider === "claude") {
    if (e.type !== "assistant") return [];
    const out: Activity[] = [];
    for (const c of e.message?.content ?? []) {
      if (c.type === "tool_use") out.push({ text: describeTool(c.name, c.input), tool: true });
      else if (c.type === "text" && firstLine(c.text ?? ""))
        out.push({ text: firstLine(c.text), tool: false });
    }
    return out;
  }
  if (provider === "codex") {
    const item = e.item ?? {};
    if (e.type === "item.started" && item.type === "command_execution")
      return [{ text: `$ ${firstLine(unwrapShell(item.command ?? ""))}`, tool: true }];
    if (e.type === "item.completed" && item.type === "agent_message" && firstLine(item.text ?? ""))
      return [{ text: firstLine(item.text), tool: false }];
    if (e.type === "item.completed" && item.type === "file_change") {
      const files = (item.changes ?? []).map((c: Json) => shortPath(String(c.path ?? "")));
      return [{ text: `edit ${files.join(", ")}`.trim(), tool: true }];
    }
  }
  return [];
}

export interface RunInfo {
  dir: string;
  track: string;
  status: string;
  lapTime: number | null;
  clean: boolean;
}

/** The workspace's practice runs, oldest first. A run whose summary is not written yet is left out. */
export function readRuns(ws: string): RunInfo[] {
  const root = join(ws, "runs");
  if (!existsSync(root)) return [];
  const out: RunInfo[] = [];
  for (const d of readdirSync(root).sort()) {
    try {
      const s = JSON.parse(readFileSync(join(root, d, "summary.json"), "utf8"));
      const r = s.result ?? {};
      out.push({
        dir: d,
        track: s.track ?? "?",
        status: r.status ?? "?",
        lapTime: typeof r.lapTime === "number" ? r.lapTime : null,
        clean:
          r.status === "FINISHED" &&
          r.offTracks === 0 &&
          r.strikes === 0 &&
          existsSync(join(root, d, "driver.js")),
      });
    } catch {}
  }
  return out;
}

/** The newest practice run that finished cleanly (no crash, off-track or ECU strike). */
export function lastCleanRun(ws: string): string | undefined {
  return readRuns(ws)
    .filter((r) => r.clean)
    .pop()?.dir;
}

/** True if the file is byte-identical to the driver of some clean practice run. */
export function isCleanTested(ws: string, file: string): boolean {
  const body = readFileSync(file);
  return readRuns(ws).some((r) => r.clean && readFileSync(join(ws, "runs", r.dir, "driver.js")).equals(body));
}

export function outcomeOf(
  exit: { code: number | null; signal: string | null; timedOut: boolean },
  signals: Record<string, number>,
): string {
  if (exit.timedOut) return "timeout";
  if (exit.code === 0) return "ok";
  const code = exit.code ?? 128 + (signals[exit.signal ?? ""] ?? 0);
  return `cli exit ${code}`;
}

export interface ManifestInput {
  entry: PlanEntry;
  opts: Pick<BuildOptions, "practice" | "timeout">;
  promptVersion: string;
  ddkVersion: string;
  simVersion: string;
  outcome: string;
  source: string;
  runs: number | null;
  wallTimeS: number;
  usage: Usage;
}

export function buildManifest(m: ManifestInput): Record<string, unknown> {
  const usage = Object.fromEntries(
    Object.entries({
      inputTokens: m.usage.inputTokens,
      outputTokens: m.usage.outputTokens,
      costUsd: m.usage.costUsd,
      wallTimeS: m.wallTimeS,
      practiceRuns: m.runs,
    }).filter(([, v]) => v !== null),
  );
  return {
    model: m.entry.name,
    provider: PROVIDERS[m.entry.provider].org,
    mode: "agentic",
    promptVersion: m.promptVersion,
    ddkVersion: m.ddkVersion,
    simVersion: m.simVersion,
    usage,
    settings: {
      modelId: m.entry.id,
      cli: m.entry.provider,
      practiceTracks: m.opts.practice,
      sandbox: "bubblewrap",
      timeLimitMin: m.opts.timeout,
      effort: m.entry.provider === "gemini" ? null : m.entry.effort,
      outcome: m.outcome,
      driverSource: m.source,
      turns: m.usage.turns,
      cliError: m.usage.error,
    },
  };
}

export function fillPrompt(template: string, timeout: number, deadline: string): string {
  return template.replaceAll("{{TIME_LIMIT}}", String(timeout)).replaceAll("{{DEADLINE}}", deadline);
}

/** Local wall-clock time as HH:MM, the form the prompt states the deadline in. */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function tokens(n: number | null): string {
  if (n === null) return "–";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

export function promptVersion(agenticPrompt: string): string {
  return agenticPrompt.match(/prompt version: (\S+)/)?.[1] ?? "";
}
