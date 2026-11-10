/**
 * `bench build <name>`: one driver per model in models.json, each written by the model's own coding CLI
 * (claude, codex, gemini) running unattended in a bubblewrap sandbox that only sees its workspace.
 *
 * Output: drivers/<name>/<slug>/{driver.js,manifest.json} and drivers/<name>/event.json, so that
 * `bench race <name>` times them on every circuit, the ones none of them practised on included. Logs go to
 * results/builds/<name>/<slug>/build/.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DDK_VERSION, SIM_VERSION } from "@bench/sim";
import { render } from "ink";
import { readJson, repoRoot, trackPath, writeJson } from "../load.js";
import { trackIds } from "../tracks.js";
import { createWorkspace } from "../workspace.js";
import { type BuildOptions, cliCmd, PROVIDERS, planBuilds, promptVersion, sandboxArgs } from "./lib.js";
import { buildAll, type Context, children, makeWorkspace, practiceStatus, Store, stopAll } from "./run.js";
import { App } from "./ui.js";

const HOME = homedir();

const has = (cmd: string) => spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function serviceUp(url: string, ms: number): Promise<boolean> {
  try {
    await fetch(`${url}/status`, { signal: AbortSignal.timeout(ms) });
    return true;
  } catch {
    return false;
  }
}

function plainLog(text: string) {
  const d = new Date();
  const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
  console.log(`[${t}] ${text}`);
}

/**
 * The practice service, reused when one already answers on the port. It runs in its own process: practice
 * runs are CPU-bound and would freeze the live view.
 */
async function startService(
  repo: string,
  port: number,
  logFile: string,
  say: (s: string) => void,
): Promise<{ label: string; child?: ChildProcess }> {
  const url = `http://127.0.0.1:${port}`;
  if (await serviceUp(url, 2000)) {
    say(`reusing the practice service on ${url}`);
    return { label: `practice service ${url} (reused)` };
  }
  const fd = openSync(logFile, "w");
  const child = spawn("pnpm", ["-s", "bench", "serve", "--port", String(port)], {
    cwd: repo,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  for (let i = 0; i < 60 && !(await serviceUp(url, 1000)); i++) await sleep(500);
  if (!(await serviceUp(url, 2000))) {
    const tail = readFileSync(logFile, "utf8").trim().split("\n").slice(-3).join("\n");
    throw new Error(`practice service did not start: ${tail}`);
  }
  say(`practice service on ${url}`);
  return { label: `practice service ${url}`, child };
}

/** Checks the sandbox hides what it should and that each provider's CLI runs inside it. */
function check(repo: string, opts: BuildOptions, providers: string[], wsRoot: string, url: string): number {
  let fail = 0;
  for (const p of providers) {
    const ws = join(wsRoot, `check-${p}`);
    createWorkspace(ws, { model: `check-${p}`, serviceUrl: url, tracks: opts.practice, budget: 1 });
    const cli = PROVIDERS[p as keyof typeof PROVIDERS].cli;
    const probe = `
      set -e
      [[ -z "$(ls -A "$1" 2>/dev/null)" ]] || { echo "repo visible"; exit 1; }
      [[ ! -s "$HOME/.claude/CLAUDE.md" ]] || { echo "user CLAUDE.md visible"; exit 1; }
      [[ -z "$(ls -A "$HOME/.claude/projects" 2>/dev/null)" ]] || { echo "session history visible"; exit 1; }
      ! touch "$HOME/.build-drivers-probe" 2>/dev/null || { rm -f "$HOME/.build-drivers-probe"; echo "home writable"; exit 1; }
      [[ -f TASK.md ]] || { echo "workspace missing"; exit 1; }
      node bench.mjs status >/dev/null || { echo "practice service unreachable"; exit 1; }
      "$2" --version >/dev/null 2>&1 || { echo "$2 --version failed"; exit 1; }`;
    const r = spawnSync("bwrap", [...sandboxArgs(ws, repo, HOME), "bash", "-c", probe, "_", repo, cli], {
      encoding: "utf8",
    });
    if (r.status === 0) plainLog(`check ${p}: ok (repo hidden, practice service reachable, ${cli} runs)`);
    else {
      plainLog(`check ${p}: FAILED: ${`${r.stdout}${r.stderr}`.trim().split("\n").pop()}`);
      fail = 1;
    }
  }
  return fail;
}

export async function build(opts: BuildOptions): Promise<number> {
  const repo = repoRoot();
  for (const t of opts.practice)
    if (!existsSync(trackPath(t))) throw new Error(`unknown track '${t}' (see: bench tracks)`);
  if (trackIds().every((t) => opts.practice.includes(t)))
    throw new Error("practice covers every circuit: leave at least one that no model sees");
  if (!existsSync(opts.models)) throw new Error(`no model list at ${opts.models}`);
  for (const c of ["bwrap", "node", "pnpm"]) if (!has(c)) throw new Error(`${c} is required`);

  const out = join(repo, "drivers", opts.name);
  const res = join(repo, "results", "builds", opts.name);
  const url = `http://127.0.0.1:${opts.port}`;
  const { plan, skipped } = planBuilds(readJson(opts.models), opts, has);
  for (const s of skipped) console.log(`skipping ${s}`);
  if (!plan.length) throw new Error("nothing to build");
  if (!opts.check)
    for (const e of plan)
      if (existsSync(join(out, e.slug)))
        throw new Error(`${join(out, e.slug)} already exists; pick another name or remove it`);

  const jobs = opts.jobs || plan.length;
  const live = !opts.plain && !opts.check && !opts.dryRun && process.stdout.isTTY === true;
  if (!live) {
    console.log(
      `building ${plan.length} drivers into drivers/${opts.name}/ (practice on ${opts.practice.join(",")}), ` +
        `${jobs} at a time, ${opts.timeout} min each:`,
    );
    for (const e of plan) console.log(`  ${e.provider}  ${e.id}  ${e.name}  ${e.effort}`);
  }
  const promptTemplate = readFileSync(join(repo, "ddk/PROMPT_LAUNCH.md"), "utf8").replace(/\n$/, "");
  if (opts.dryRun) {
    const e = plan[0]!;
    const cmd = cliCmd(e.provider, e.id, e.effort, promptTemplate);
    console.log("command for the first model, in its sandbox:");
    console.log(cmd.map((c) => (c === promptTemplate ? "<prompt>" : JSON.stringify(c))).join(" "));
    return 0;
  }

  const wsRoot = mkdtempSync(join(tmpdir(), `bench-build-${opts.name}.`));
  let service: ChildProcess | undefined;
  const cleanup = () => {
    stopAll();
    if (service?.pid) {
      try {
        process.kill(-service.pid, "SIGTERM");
      } catch {}
      service.unref();
    }
    rmSync(wsRoot, { recursive: true, force: true });
  };

  if (opts.check) {
    try {
      service = (await startService(repo, opts.port, join(wsRoot, "serve.log"), plainLog)).child;
      return check(repo, opts, [...new Set(plan.map((e) => e.provider))], wsRoot, url);
    } finally {
      cleanup();
    }
  }

  mkdirSync(res, { recursive: true });
  const event = join(out, "event.json");
  if (!existsSync(event)) writeJson(event, { name: opts.name, seed: 2026 });

  const store = new Store(plan);
  const ctx: Context = {
    repo,
    home: HOME,
    opts,
    wsRoot,
    out,
    res,
    url,
    promptTemplate,
    promptVersion: promptVersion(readFileSync(join(repo, "ddk/PROMPT_AGENTIC.md"), "utf8")),
    simVersion: SIM_VERSION,
    ddkVersion: DDK_VERSION,
    baseline: join(repo, "ddk/baseline-driver.js"),
    store,
  };

  let interrupts = 0;
  const abort = () => {
    interrupts++;
    if (interrupts > 1) stopAll("SIGKILL");
    if (store.aborting) return;
    store.aborting = true;
    store.say("interrupted: stopping every model");
    stopAll();
  };
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);

  let printed = 0;
  const unsubscribe = live
    ? () => {}
    : store.subscribe(() => {
        for (; printed < store.log.length; printed++) plainLog(store.log[printed]!.text);
      });
  const header = {
    name: opts.name,
    practice: opts.practice,
    timeout: opts.timeout,
    jobs,
    effort: [...new Set(plan.map((e) => e.effort))].join("/"),
  };
  const ink = live
    ? render(<App store={store} header={header} onAbort={abort} />, { exitOnCtrlC: false })
    : undefined;

  try {
    const svc = await startService(repo, opts.port, join(res, "serve.log"), (s) => store.say(s));
    service = svc.child;
    store.service = svc.label;
    for (const e of plan) {
      if (store.aborting) break;
      makeWorkspace(ctx, e);
    }
    for (const e of plan) {
      if (store.aborting) break;
      const s = practiceStatus(join(wsRoot, e.slug));
      if (!s) throw new Error(`${e.slug}: the practice service does not know its token`);
      store.update(e.slug, { state: "queued", budget: s.budget });
    }
    if (!store.aborting) {
      store.say(`${plan.length} workspaces ready`);
      await buildAll(ctx, plan, jobs);
    }
  } finally {
    store.finished = true;
    store.changed();
    ink?.unmount();
    await ink?.waitUntilExit();
    unsubscribe();
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
    cleanup();
    // A model's leftover process must not keep the command alive.
    if (children.size) setTimeout(() => process.exit(store.aborting ? 130 : 1), 1000).unref();
  }
  if (store.aborting) return 130;

  console.log(`\ndrivers in drivers/${opts.name}/:`);
  for (const d of readdirSync(out, { withFileTypes: true })) if (d.isDirectory()) console.log(`  ${d.name}`);
  console.log(`time them: pnpm bench event run ${opts.name}`);
  return 0;
}
