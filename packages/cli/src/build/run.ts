import { type ChildProcess, spawn } from "node:child_process";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { readJson } from "../load.js";
import { readTokens } from "../service.js";
import { createWorkspace } from "../workspace.js";
import {
  type BuildOptions,
  buildManifest,
  cliCmd,
  fillPrompt,
  hhmm,
  isCleanTested,
  lastCleanRun,
  outcomeOf,
  type PlanEntry,
  parseActivity,
  parseUsage,
  type RunInfo,
  readRuns,
  sandboxArgs,
  type Usage,
} from "./lib.js";

export type State =
  | "queued"
  | "workspace"
  | "running"
  | "collecting"
  | "done"
  | "no driver"
  | "failed"
  | "aborted";

export interface ModelView {
  entry: PlanEntry;
  state: State;
  startedAt?: number;
  endedAt?: number;
  deadline?: string;
  budget: number | null;
  runs: RunInfo[];
  toolCalls: number;
  activity: string;
  outcome?: string;
  source?: string;
  usage?: Usage;
}

export interface LogLine {
  id: number;
  time: string;
  text: string;
}

/** Everything the live view shows, mutated in place; `version` changes on every update. */
export class Store {
  models: ModelView[];
  log: LogLine[] = [];
  service = "";
  finished = false;
  aborting = false;
  version = 0;
  private listeners = new Set<() => void>();

  constructor(plan: PlanEntry[]) {
    this.models = plan.map((entry) => ({
      entry,
      state: "queued",
      budget: null,
      runs: [],
      toolCalls: 0,
      activity: "",
    }));
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  say(text: string) {
    const d = new Date();
    const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
    this.log = [...this.log, { id: this.log.length, time, text }];
    this.changed();
  }

  update(slug: string, patch: Partial<ModelView>) {
    const m = this.models.find((x) => x.entry.slug === slug)!;
    Object.assign(m, patch);
    this.changed();
  }
}

export interface Context {
  repo: string;
  home: string;
  opts: BuildOptions;
  wsRoot: string;
  out: string;
  res: string;
  url: string;
  promptTemplate: string;
  promptVersion: string;
  simVersion: string;
  driverDevelopmentKitVersion: string;
  baseline: string;
  store: Store;
}

/** Live model processes, so an abort or a fatal error can stop all of them. */
export const children = new Set<ChildProcess>();

/**
 * Each sandbox leads its own process group: killing bwrap alone takes the CLI down but leaves
 * the commands it started, which keep its stdout open.
 */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
  try {
    process.kill(-child.pid!, signal);
  } catch {}
}

export function stopAll(signal: NodeJS.Signals = "SIGTERM") {
  for (const c of children) signalGroup(c, signal);
}

/**
 * Workspaces are created one at a time, before any model runs: each registers its token by
 * rewriting results/agentic/tokens.json, so concurrent registrations would drop each other.
 */
export function makeWorkspace(ctx: Context, e: PlanEntry) {
  mkdirSync(join(ctx.res, e.slug, "build"), { recursive: true });
  ctx.store.update(e.slug, { state: "workspace" });
  createWorkspace(join(ctx.wsRoot, e.slug), {
    model: e.slug,
    serviceUrl: ctx.url,
    tracks: ctx.opts.practice,
    budget: ctx.opts.budget,
  });
}

/** Practice runs used and budget of a workspace's token, or null if the service does not know it. */
export function practiceStatus(ws: string): { used: number; budget: number } | null {
  const { token } = readJson<{ token: string }>(join(ws, ".bench.json"));
  const rec = readTokens()[token];
  return rec ? { used: rec.used, budget: rec.budget } : null;
}

export async function buildOne(ctx: Context, e: PlanEntry): Promise<void> {
  const { store, opts } = ctx;
  const ws = join(ctx.wsRoot, e.slug);
  const logs = join(ctx.res, e.slug, "build");
  const start = Date.now();
  const deadline = hhmm(start + opts.timeout * 60_000);
  const prompt = fillPrompt(ctx.promptTemplate, opts.timeout, deadline);
  writeFileSync(join(logs, "prompt.txt"), `${prompt}\n`);
  store.update(e.slug, { state: "running", startedAt: start, deadline, activity: "starting" });
  store.say(`${e.slug}: started (${e.cli}, effort ${e.effort}, until ${deadline})`);

  const out = createWriteStream(join(logs, "output.json"));
  const err = openSync(join(logs, "stderr.txt"), "w");
  const cmd = cliCmd(e.cli, e.id, e.effort, prompt);
  const child = spawn("bwrap", [...sandboxArgs(ws, ctx.repo, ctx.home), ...cmd], {
    stdio: ["ignore", "pipe", err],
    detached: true,
  });
  children.add(child);

  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  const limit = setTimeout(() => {
    timedOut = true;
    signalGroup(child, "SIGTERM");
    killTimer = setTimeout(() => signalGroup(child, "SIGKILL"), 30_000);
  }, opts.timeout * 60_000);
  const poll = setInterval(() => {
    const runs = readRuns(ws);
    const m = store.models.find((x) => x.entry.slug === e.slug)!;
    if (runs.length !== m.runs.length) store.update(e.slug, { runs });
  }, 2000);

  let buf = "";
  let toolCalls = 0;
  child.stdout!.on("data", (chunk: Buffer) => {
    out.write(chunk);
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      const acts = parseActivity(e.cli, line);
      if (!acts.length) continue;
      toolCalls += acts.filter((a) => a.tool).length;
      store.update(e.slug, { toolCalls, activity: acts[acts.length - 1]!.text });
    }
  });

  const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  }).finally(() => {
    signalGroup(child, "SIGKILL");
    children.delete(child);
    clearTimeout(limit);
    clearTimeout(killTimer);
    clearInterval(poll);
  });
  if (!child.stdout!.closed) {
    const closed = new Promise((r) => child.stdout!.once("close", r));
    await Promise.race([closed, new Promise((r) => setTimeout(r, 2000))]);
    child.stdout!.destroy();
  }
  await new Promise<void>((r) => out.end(r));
  const end = Date.now();
  const wall = Math.round((end - start) / 1000);

  if (store.aborting) {
    store.update(e.slug, { state: "aborted", endedAt: end, activity: "" });
    return;
  }
  store.update(e.slug, { state: "collecting", endedAt: end, runs: readRuns(ws) });
  const status = practiceStatus(ws);
  if (existsSync(join(ws, "runs"))) cpSync(join(ws, "runs"), join(logs, "runs"), { recursive: true });
  const driver = join(ws, "driver.js");
  if (existsSync(driver)) cpSync(driver, join(logs, "driver.js"));

  const outcome = outcomeOf({ ...exit, timedOut }, constants.signals as Record<string, number>);
  const usage = parseUsage(e.cli, readFileSync(join(logs, "output.json"), "utf8"));
  const empty = !existsSync(driver) || readFileSync(driver).length === 0;
  if (empty || readFileSync(driver).equals(readFileSync(ctx.baseline))) {
    store.update(e.slug, { state: "no driver", outcome, usage, activity: "" });
    store.say(`${e.slug}: no driver written (${outcome}, ${wall} s), skipped; see ${logs}/`);
    return;
  }

  // A model cut off by the time limit may leave a half-edited driver.js: fall back to the newest
  // driver that completed a clean practice run, unless driver.js is itself one of those.
  let source = "driver.js";
  if (outcome !== "ok" && !isCleanTested(ws, driver)) {
    const clean = lastCleanRun(ws);
    if (clean) source = `runs/${clean}/driver.js`;
  }
  mkdirSync(join(ctx.out, e.slug), { recursive: true });
  cpSync(join(ws, source), join(ctx.out, e.slug, "driver.js"));
  const manifest = buildManifest({
    entry: e,
    opts,
    promptVersion: ctx.promptVersion,
    driverDevelopmentKitVersion: ctx.driverDevelopmentKitVersion,
    simVersion: ctx.simVersion,
    outcome,
    source,
    runs: status?.used ?? null,
    wallTimeS: wall,
    usage,
  });
  writeFileSync(join(ctx.out, e.slug, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  store.update(e.slug, { state: "done", outcome, source, usage, activity: "" });
  store.say(
    `${e.slug}: done (${outcome}, ${wall} s, ${status?.used ?? "?"} practice runs, driver from ${source})`,
  );
}

/** Runs `jobs` builds at a time, in plan order. */
export async function buildAll(ctx: Context, plan: PlanEntry[], jobs: number): Promise<void> {
  const queue = [...plan];
  const worker = async () => {
    for (let e = queue.shift(); e && !ctx.store.aborting; e = queue.shift()) {
      try {
        await buildOne(ctx, e);
      } catch (err) {
        ctx.store.update(e.slug, { state: "failed", endedAt: Date.now(), activity: String(err) });
        ctx.store.say(`${e.slug}: failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, plan.length) }, worker));
  for (const m of ctx.store.models) if (m.state === "queued") m.state = "aborted";
  ctx.store.finished = true;
  ctx.store.changed();
}
