import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SandboxOptions } from "@bench/sandbox";
import {
  CarSim,
  type Replay,
  runSession,
  type SessionConfig,
  type SessionOutput,
  type SessionResults,
  summarizeSession,
  type Track,
  telemetryCsv,
} from "@bench/sim";
import {
  type LoadedDriver,
  loadCar,
  loadDriver,
  loadDriverOrFailed,
  loadTrack,
  repoRoot,
  writeJson,
} from "./load.js";

export interface SessionOpts {
  track: string;
  seed?: number;
  out?: string;
  sandbox?: Partial<SandboxOptions>;
}

export interface CommandOutput {
  text: string;
  results?: SessionResults;
}

/** `results/<kind>/<stem>-NNN`, the first number not taken. */
function nextDir(kind: string, stem: string): string {
  const base = join(repoRoot(), "results", kind);
  mkdirSync(base, { recursive: true });
  for (let i = 1; ; i++) {
    const d = join(base, `${stem}-${String(i).padStart(3, "0")}`);
    if (!existsSync(d)) return d;
  }
}

/** A path as the user would type it: relative to the working directory when inside it. */
export function rel(p: string): string {
  const r = relative(process.cwd(), p);
  return r.startsWith("..") ? p : r || ".";
}

export function readReplay(path: string): Replay {
  const buf = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8")) as Replay;
}

/** replay.json.gz, results.json and summary.txt; returns the files written. */
export function writeSession(dir: string, out: SessionOutput, extra: Record<string, unknown> = {}): string[] {
  mkdirSync(dir, { recursive: true });
  const files = ["replay.json.gz", "results.json", "summary.txt"].map((f) => join(dir, f));
  writeFileSync(files[0]!, gzipSync(JSON.stringify(out.replay)));
  writeJson(files[1]!, { ...out.results, ...extra });
  writeFileSync(files[2]!, summarizeSession(out.results, out.runs));
  return files;
}

/** One session of loaded drivers, ghost mode. */
export function runDrivers(track: Track, drivers: LoadedDriver[], seed: number): SessionOutput {
  const entries = drivers.map((d) => ({ id: d.id, name: d.name, runtime: d.runtime, driverHash: d.hash }));
  return runSession(track, loadCar(), entries, { seed });
}

/** Load driver files; a module that fails to load still takes part, as an ECU failure. Ids are made unique. */
export async function loadEntries(
  paths: string[],
  sandbox: Partial<SandboxOptions>,
): Promise<LoadedDriver[]> {
  const drivers: LoadedDriver[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const d = await loadDriverOrFailed(p, sandbox);
    let k = 1;
    while (seen.has(k > 1 ? `${d.id}-${k}` : d.id)) k++;
    if (k > 1) {
      d.id = `${d.id}-${k}`;
      d.name = `${d.name} #${k}`;
    }
    seen.add(d.id);
    drivers.push(d);
  }
  return drivers;
}

/** Load, init and run 10 s of a driver; reports errors, budget use and timings. */
export async function validate(
  driverPath: string,
  opts: SessionOpts,
): Promise<CommandOutput & { ok: boolean }> {
  const lines: string[] = [`validate ${driverPath}`];
  const done = (ok: boolean) => ({ ok, text: `${lines.join("\n")}\n` });
  let d: LoadedDriver;
  const t0 = performance.now();
  try {
    d = await loadDriver(driverPath, { ...opts.sandbox, logging: true });
  } catch (e) {
    lines.push(`FAIL load: ${(e as Error).message}`);
    return done(false);
  }
  lines.push(`ok   load (${(performance.now() - t0).toFixed(0)} ms, driver hash ${d.hash})`);
  const cfg: SessionConfig = { seed: opts.seed ?? 1, timeLimit: 10 };
  const sim = new CarSim(
    loadTrack(opts.track),
    loadCar(),
    { id: d.id, name: d.name, runtime: d.runtime },
    cfg,
  );
  const t1 = performance.now();
  const initOk = sim.init();
  const initMs = performance.now() - t1;
  if (!initOk) {
    lines.push(`FAIL init: ${sim.finish().result.errors.join("; ")}`);
    d.runtime.dispose();
    return done(false);
  }
  const { usage, budgets, logs } = d.runtime;
  lines.push(`ok   init (${initMs.toFixed(0)} ms, ${usage.init} of ${budgets.init} budget units)`);
  const t2 = performance.now();
  while (sim.status === "RUNNING") sim.tick();
  const stepUs = ((performance.now() - t2) / Math.max(1, usage.steps)) * 1000;
  const r = sim.finish().result;
  lines.push(
    `${r.strikes ? "WARN" : "ok  "} step x${usage.steps} (${stepUs.toFixed(0)} us/step avg incl. physics, max ${usage.stepMax} of ${budgets.step} budget units)`,
  );
  const st = sim.telemetryNow();
  lines.push(
    `     after ${sim.t.toFixed(1)} s: status ${r.status}, s=${st.s.toFixed(1)} m, speed ${(st.speed * 3.6).toFixed(0)} km/h, n=${st.n.toFixed(2)} m, strikes ${r.strikes}`,
  );
  for (const e of r.errors) lines.push(`     error: ${e}`);
  if (logs.length) {
    lines.push(`     log (first ${Math.min(10, logs.length)} lines):`);
    for (const l of logs.slice(0, 10)) lines.push(`       ${l}`);
  }
  d.runtime.dispose();
  const ok = r.strikes === 0 && (r.status === "TIME UP" || r.status === "FINISHED");
  lines.push(ok ? "PASS" : "FAIL");
  return done(ok);
}

export async function practice(driverPath: string, opts: SessionOpts): Promise<CommandOutput> {
  const d = await loadDriver(driverPath, { ...opts.sandbox, logging: true, seed: opts.seed ?? 1 });
  return practiceWith(d, driverPath, opts);
}

/** One flying lap with telemetry: what `bench practice` and the practice service give a driver's author. */
export async function practiceWith(
  d: LoadedDriver,
  driverPath: string,
  opts: SessionOpts,
): Promise<CommandOutput> {
  const track = loadTrack(opts.track);
  const out = runSession(
    track,
    loadCar(),
    [{ id: d.id, name: d.name, runtime: d.runtime, driverHash: d.hash }],
    { seed: opts.seed ?? 1, recordTelemetry: true },
  );
  const dir = opts.out ? resolve(opts.out) : nextDir("practice", d.id);
  const run = out.runs[0]!;
  const usage = { ...d.runtime.usage };
  const files = writeSession(dir, out, { budgetUsage: usage });
  files.push(join(dir, "telemetry.csv"), join(dir, "summary.json"), join(dir, "log.txt"));
  writeFileSync(join(dir, "telemetry.csv"), telemetryCsv(run.telemetry!));
  writeJson(join(dir, "summary.json"), {
    driver: driverPath,
    driverHash: d.hash,
    track: track.id,
    trackLength: track.length,
    result: run.result,
    events: run.events,
    budgetUsage: usage,
  });
  const logs = [...d.runtime.logs];
  if (d.runtime.logsDropped) logs.push(`... ${d.runtime.logsDropped} more lines dropped`);
  writeFileSync(join(dir, "log.txt"), `${logs.join("\n")}\n`);
  const text = [
    summarizeSession(out.results, out.runs).trimEnd(),
    "",
    `budget: init ${usage.init} units, step max ${usage.stepMax} units`,
    `files: ${files.map(rel).join(", ")}`,
    "telemetry.csv columns: t, s, speed, throttle, brake, steer, n, surface, ax, ay (one row per 20 ms step)",
  ].join("\n");
  return { text: `${text}\n`, results: out.results };
}

/** One flying lap per driver, replayed together. */
export async function qualify(driverPaths: string[], opts: SessionOpts): Promise<CommandOutput> {
  const track = loadTrack(opts.track);
  const seed = opts.seed ?? 1;
  const out = runDrivers(track, await loadEntries(driverPaths, { ...opts.sandbox, seed }), seed);
  const files = writeSession(opts.out ? resolve(opts.out) : nextDir("qualify", track.id), out);
  return {
    text: `${summarizeSession(out.results, out.runs)}\nfiles: ${files.map(rel).join(", ")}\n`,
    results: out.results,
  };
}
