import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SandboxOptions } from "@bench/sandbox";
import {
  type CarConfig,
  CarSim,
  CONTROL_HZ,
  fmtTime,
  type Replay,
  runSession,
  type SessionConfig,
  type SessionEntry,
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
  loadReference,
  loadTrack,
  readJson,
  repoRoot,
} from "./load.js";

export { loadDriverSource } from "./load.js";

export interface CommonOpts {
  track: string;
  car?: string;
  seed?: number;
  infoLevel?: "A" | "B";
  out?: string;
  sandbox?: Partial<SandboxOptions>;
}

export interface CommandOutput {
  text: string;
  outDir?: string;
  results?: SessionResults;
}

function nextDir(base: string, stem: string): string {
  mkdirSync(base, { recursive: true });
  for (let i = 1; ; i++) {
    const d = join(base, `${stem}-${String(i).padStart(3, "0")}`);
    if (!existsSync(d)) return d;
  }
}

function rel(p: string): string {
  const r = relative(process.cwd(), p);
  return r.startsWith("..") ? p : r || ".";
}

export function writeReplay(path: string, replay: Replay): void {
  writeFileSync(path, gzipSync(JSON.stringify(replay)));
}

export function readReplay(path: string): Replay {
  const buf = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8")) as Replay;
}

function writeSession(dir: string, out: SessionOutput, extra: Record<string, unknown> = {}): string[] {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const w = (name: string, data: string | Buffer) => {
    writeFileSync(join(dir, name), data);
    files.push(join(dir, name));
  };
  writeReplay(join(dir, "replay.json.gz"), out.replay);
  files.push(join(dir, "replay.json.gz"));
  w("results.json", `${JSON.stringify({ ...out.results, ...extra }, null, 2)}\n`);
  w("summary.txt", summarizeSession(out.results, out.runs));
  return files;
}

// ---- validate ---------------------------------------------------------------------------------------

export async function validate(
  driverPath: string,
  opts: CommonOpts,
): Promise<CommandOutput & { ok: boolean }> {
  const lines: string[] = [`validate ${driverPath}`];
  let d: LoadedDriver;
  const t0 = performance.now();
  try {
    d = await loadDriver(driverPath, { ...opts.sandbox, logging: true });
  } catch (e) {
    lines.push(`FAIL load: ${(e as Error).message}`);
    return { ok: false, text: `${lines.join("\n")}\n` };
  }
  lines.push(`ok   load (${(performance.now() - t0).toFixed(0)} ms, driver hash ${d.hash})`);
  const track = loadTrack(opts.track);
  const car = loadCar(opts.car);
  const cfg: SessionConfig = {
    type: "practice",
    laps: 1,
    seed: opts.seed ?? 1,
    timeLimit: 10,
    infoLevel: opts.infoLevel ?? "B",
  };
  const sim = new CarSim(track, car, { id: d.id, name: d.name, runtime: d.runtime }, cfg);
  const t1 = performance.now();
  const initOk = sim.init();
  const initMs = performance.now() - t1;
  if (!initOk) {
    lines.push(`FAIL init: ${sim.finish().result.errors.join("; ")}`);
    d.runtime.dispose();
    return { ok: false, text: `${lines.join("\n")}\n` };
  }
  lines.push(
    `ok   init (${initMs.toFixed(0)} ms, ${d.runtime.usage.init} of ${d.runtime.budgets.init} budget units)`,
  );
  const t2 = performance.now();
  while (sim.status === "RUNNING") sim.tick();
  const stepMs = performance.now() - t2;
  const run = sim.finish();
  const r = run.result;
  const steps = d.runtime.usage.steps;
  lines.push(
    `${r.strikes ? "WARN" : "ok  "} step x${steps} (${((stepMs / Math.max(1, steps)) * 1000).toFixed(0)} us/step avg incl. physics, max ${d.runtime.usage.stepMax} of ${d.runtime.budgets.step} budget units)`,
  );
  const st = sim.telemetryNow();
  lines.push(
    `     after ${sim.t.toFixed(1)} s: status ${r.status}, s=${st.s.toFixed(1)} m, speed ${(st.speed * 3.6).toFixed(0)} km/h, n=${st.n.toFixed(2)} m, strikes ${r.strikes}`,
  );
  for (const e of r.errors) lines.push(`     error: ${e}`);
  if (d.runtime.logs.length) {
    lines.push(`     log (first ${Math.min(10, d.runtime.logs.length)} lines):`);
    for (const l of d.runtime.logs.slice(0, 10)) lines.push(`       ${l}`);
  }
  d.runtime.dispose();
  const ok = r.strikes === 0 && (r.status === "TIME UP" || r.status === "FINISHED");
  lines.push(ok ? "PASS" : "FAIL");
  return { ok, text: `${lines.join("\n")}\n` };
}

// ---- practice -------------------------------------------------------------------------------------

export async function practice(
  driverPath: string,
  opts: CommonOpts & { laps: number },
): Promise<CommandOutput> {
  const d = await loadDriver(driverPath, { ...opts.sandbox, logging: true, seed: opts.seed ?? 1 });
  return practiceWith(d, driverPath, opts);
}

export async function practiceWith(
  d: LoadedDriver,
  driverPath: string,
  opts: CommonOpts & { laps: number },
): Promise<CommandOutput> {
  const track = loadTrack(opts.track);
  const car = loadCar(opts.car);
  const cfg: SessionConfig = {
    type: "practice",
    laps: opts.laps,
    seed: opts.seed ?? 1,
    infoLevel: opts.infoLevel ?? "B",
    recordTelemetry: true,
  };
  const out = runSession(
    track,
    car,
    [{ id: d.id, name: d.name, runtime: d.runtime, driverHash: d.hash }],
    cfg,
  );
  const dir = opts.out ? resolve(opts.out) : nextDir(join(repoRoot(), "results", "practice"), d.id);
  const run = out.runs[0]!;
  const usage = { ...d.runtime.usage };
  const files = writeSession(dir, out, { budgetUsage: usage });
  writeFileSync(join(dir, "telemetry.csv"), telemetryCsv(run.telemetry!));
  const logs = [...d.runtime.logs];
  if (d.runtime.logsDropped) logs.push(`... ${d.runtime.logsDropped} more lines dropped`);
  writeFileSync(join(dir, "log.txt"), `${logs.join("\n")}\n`);
  const summary = {
    driver: driverPath,
    driverHash: d.hash,
    track: track.id,
    trackLength: track.length,
    result: run.result,
    events: run.events,
    budgetUsage: usage,
  };
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const text = [
    summarizeSession(out.results, out.runs).trimEnd(),
    "",
    `budget: init ${usage.init} units, step max ${usage.stepMax} units`,
    `files: ${[...files, join(dir, "telemetry.csv"), join(dir, "summary.json"), join(dir, "log.txt")].map(rel).join(", ")}`,
    "telemetry.csv columns: t, lap, s, speed, throttle, brake, steer, n, surface, ax, ay (one row per 20 ms step)",
  ].join("\n");
  return { text: `${text}\n`, outDir: dir, results: out.results };
}

// ---- qualify / race -------------------------------------------------------------------------------

export interface SessionOpts extends CommonOpts {
  laps: number;
  reference?: boolean;
}

export async function loadEntries(paths: string[], sandbox: Partial<SandboxOptions>, reference: boolean) {
  const drivers: LoadedDriver[] = [];
  for (const p of paths) drivers.push(await loadDriverOrFailed(p, sandbox));
  if (reference) drivers.push(await loadReference(sandbox));
  const seen = new Set<string>();
  for (const d of drivers) {
    let id = d.id;
    let k = 1;
    while (seen.has(id)) id = `${d.id}-${++k}`;
    if (k > 1) d.name = `${d.name} #${k}`;
    d.id = id;
    seen.add(id);
  }
  return drivers;
}

export function runWithDrivers(
  track: Track,
  car: CarConfig,
  drivers: LoadedDriver[],
  cfg: SessionConfig,
): SessionOutput & { referenceLap?: number } {
  const entries: SessionEntry[] = drivers.map((d) => ({
    id: d.id,
    name: d.name,
    runtime: d.runtime,
    driverHash: d.hash,
  }));
  const out = runSession(track, car, entries, cfg);
  const ref = out.results.classification.find((c) => c.id === "reference");
  if (ref?.bestLap) out.replay.header.referenceLap = ref.bestLap;
  return { ...out, referenceLap: ref?.bestLap ?? undefined };
}

export async function session(
  type: "qualify" | "race",
  driverPaths: string[],
  opts: SessionOpts,
): Promise<CommandOutput> {
  const track = loadTrack(opts.track);
  const car = loadCar(opts.car);
  const seed = opts.seed ?? 1;
  const drivers = await loadEntries(driverPaths, { ...opts.sandbox, seed }, opts.reference ?? false);
  const cfg: SessionConfig = { type, laps: opts.laps, seed, infoLevel: opts.infoLevel ?? "B" };
  const out = runWithDrivers(track, car, drivers, cfg);
  const dir = opts.out ? resolve(opts.out) : nextDir(join(repoRoot(), "results", type), track.id);
  const files = writeSession(dir, out, out.referenceLap ? { referenceLap: out.referenceLap } : {});
  let text = summarizeSession(out.results, out.runs);
  if (out.referenceLap) {
    text += `\nreference lap ${fmtTime(out.referenceLap)}; gap to reference:\n`;
    for (const c of out.results.classification)
      if (c.id !== "reference")
        text += `   ${c.name}: ${c.bestLap ? `+${(c.bestLap - out.referenceLap).toFixed(3)} s` : "-"}\n`;
  }
  text += `\nfiles: ${files.map(rel).join(", ")}\n`;
  return { text, outDir: dir, results: out.results };
}

// ---- events -------------------------------------------------------------------------------------------

export interface EventConfig {
  id: string;
  name: string;
  track: string;
  car?: string;
  qualifyAttempts: number;
  raceLaps: number;
  seed: number;
  infoLevel: "A" | "B";
}

export interface Manifest {
  model: string;
  provider?: string;
  mode?: "one-shot" | "agentic";
  settings?: Record<string, unknown>;
  promptVersion?: string;
  ddkVersion?: string;
  simVersion?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    wallTimeS?: number;
    practiceRuns?: number;
  };
  driverHash?: string;
  transcript?: string;
  /** Filled by `bench event run`. */
  results?: {
    qualifyHash: string;
    raceHash: string;
    qualifyTime: number | null;
    raceTime: number | null;
    status: string;
  };
}

export interface EventResultRow {
  slug: string;
  name: string;
  driverHash: string;
  qualifyTime: number | null;
  qualifyPosition: number;
  raceTime: number | null;
  racePosition: number;
  raceStatus: string;
  bestRaceLap: number | null;
  penalties: number;
  gapToReference: number | null;
  qualifyHash: string;
  raceHash: string;
  manifest: Manifest | null;
}

export interface EventResults {
  event: EventConfig;
  simVersion: string;
  apiVersion: string;
  trackHash: string;
  carHash: string;
  referenceLap: number | null;
  qualifyStateHash: string;
  raceStateHash: string;
  rows: EventResultRow[];
}

export function eventPaths(eventId: string) {
  const root = repoRoot();
  return {
    config: join(root, "results", eventId, "event.json"),
    drivers: join(root, "drivers", eventId),
    results: join(root, "results", eventId),
  };
}

export function listEventDrivers(eventId: string): { slug: string; path: string }[] {
  const p = eventPaths(eventId);
  if (!existsSync(p.drivers)) return [];
  return readdirSync(p.drivers, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const js = join(p.drivers, d.name, "driver.js");
      const ts = join(p.drivers, d.name, "driver.ts");
      return { slug: d.name, path: existsSync(js) ? js : ts };
    })
    .filter((d) => existsSync(d.path))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

async function runEventSessions(eventId: string) {
  const p = eventPaths(eventId);
  const ev = readJson<EventConfig>(p.config);
  const track = loadTrack(ev.track);
  const car = loadCar(ev.car);
  const list = listEventDrivers(eventId);
  const manifests = new Map<string, Manifest | null>();
  for (const d of list) {
    const mp = [join(p.results, d.slug, "manifest.json"), join(dirname(d.path), "manifest.json")].find((f) =>
      existsSync(f),
    );
    manifests.set(d.slug, mp ? readJson<Manifest>(mp) : null);
  }
  const load = async () => {
    const ds = await loadEntries(
      list.map((d) => d.path),
      { seed: ev.seed },
      true,
    );
    ds.forEach((d, i) => {
      const slug = list[i]?.slug;
      if (!slug) return;
      d.id = slug;
      d.name = manifests.get(slug)?.model ?? slug;
    });
    return ds;
  };
  const base = { seed: ev.seed, infoLevel: ev.infoLevel };
  const q = runWithDrivers(track, car, await load(), { ...base, type: "qualify", laps: ev.qualifyAttempts });
  const r = runWithDrivers(track, car, await load(), { ...base, type: "race", laps: ev.raceLaps });
  return { ev, p, list, manifests, q, r, track, car };
}

export async function runEvent(eventId: string): Promise<CommandOutput> {
  const { ev, p, list, manifests, q, r } = await runEventSessions(eventId);
  writeSession(join(p.results, "qualify"), q);
  writeSession(join(p.results, "race"), r);
  const ref = q.referenceLap ?? null;
  const rows: EventResultRow[] = list.map((d) => {
    const qc = q.results.classification.find((c) => c.id === d.slug)!;
    const rc = r.results.classification.find((c) => c.id === d.slug)!;
    const bestRace = rc.bestLap;
    return {
      slug: d.slug,
      name: qc.name,
      driverHash: qc.driverHash,
      qualifyTime: qc.bestLap,
      qualifyPosition: qc.position,
      raceTime: rc.totalTime,
      racePosition: rc.position,
      raceStatus: rc.status,
      bestRaceLap: bestRace,
      penalties: rc.penalties,
      gapToReference: ref !== null && qc.bestLap !== null ? qc.bestLap - ref : null,
      qualifyHash: qc.stateHash,
      raceHash: rc.stateHash,
      manifest: manifests.get(d.slug) ?? null,
    };
  });
  // Positions rank the models only; the house reference car is shown but not classified.
  [...rows]
    .sort((a, b) => a.qualifyPosition - b.qualifyPosition)
    .forEach((row, i) => {
      row.qualifyPosition = i + 1;
    });
  rows.sort((a, b) => a.racePosition - b.racePosition);
  rows.forEach((row, i) => {
    row.racePosition = i + 1;
  });
  const res: EventResults = {
    event: ev,
    simVersion: r.results.simVersion,
    apiVersion: r.results.apiVersion,
    trackHash: r.results.trackHash,
    carHash: r.results.carHash,
    referenceLap: ref,
    qualifyStateHash: q.results.stateHash,
    raceStateHash: r.results.stateHash,
    rows,
  };
  writeFileSync(join(p.results, "event-results.json"), `${JSON.stringify(res, null, 2)}\n`);
  for (const row of rows) {
    const m = row.manifest;
    if (!m) continue;
    m.driverHash = row.driverHash;
    m.results = {
      qualifyHash: row.qualifyHash,
      raceHash: row.raceHash,
      qualifyTime: row.qualifyTime,
      raceTime: row.raceTime,
      status: row.raceStatus,
    };
    mkdirSync(join(p.results, row.slug), { recursive: true });
    writeFileSync(join(p.results, row.slug, "manifest.json"), `${JSON.stringify(m, null, 2)}\n`);
  }
  return {
    text: `${eventTable(res)}\nfiles: ${rel(join(p.results, "event-results.json"))}, ${rel(join(p.results, "race", "replay.json.gz"))}\n`,
    outDir: p.results,
  };
}

/** Re-run an event and check every state hash against the stored results. */
export async function reproduceEvent(eventId: string): Promise<CommandOutput & { ok: boolean }> {
  const p = eventPaths(eventId);
  const stored = readJson<EventResults>(join(p.results, "event-results.json"));
  const { q, r } = await runEventSessions(eventId);
  const lines: string[] = [`reproduce ${eventId}`];
  let ok = true;
  const check = (label: string, a: string, b: string) => {
    const same = a === b;
    ok &&= same;
    lines.push(`${same ? "ok  " : "DIFF"} ${label}: ${b}${same ? "" : ` (stored ${a})`}`);
  };
  if (stored.simVersion !== r.results.simVersion)
    lines.push(`note: stored sim ${stored.simVersion}, running ${r.results.simVersion}`);
  check("qualify", stored.qualifyStateHash, q.results.stateHash);
  check("race", stored.raceStateHash, r.results.stateHash);
  for (const row of stored.rows) {
    const qc = q.results.classification.find((c) => c.id === row.slug);
    const rc = r.results.classification.find((c) => c.id === row.slug);
    check(`${row.slug} driver`, row.driverHash, qc?.driverHash ?? "missing");
    check(`${row.slug} race`, row.raceHash, rc?.stateHash ?? "missing");
  }
  lines.push(ok ? "REPRODUCED" : "MISMATCH");
  return { ok, text: `${lines.join("\n")}\n` };
}

function cost(m: Manifest | null): string {
  const c = m?.usage?.costUsd;
  return c === undefined ? "-" : `$${c.toFixed(2)}`;
}

function tokens(m: Manifest | null): string {
  const u = m?.usage;
  if (!u || (u.inputTokens === undefined && u.outputTokens === undefined)) return "-";
  return `${(((u.inputTokens ?? 0) + (u.outputTokens ?? 0)) / 1000).toFixed(0)}k`;
}

export function eventTable(res: EventResults): string {
  const head = `${res.event.name} (${res.event.id}) on ${res.event.track}, ${res.event.raceLaps} laps, seed ${res.event.seed}, info level ${res.event.infoLevel}`;
  const rows = [["Pos", "Model", "Mode", "Quali", "Gap to ref", "Race", "Status", "Pen.", "Cost", "Tokens"]];
  for (const r of res.rows) {
    rows.push([
      String(r.racePosition),
      r.name,
      r.manifest?.mode ?? "-",
      fmtTime(r.qualifyTime),
      r.gapToReference === null ? "-" : `${r.gapToReference >= 0 ? "+" : ""}${r.gapToReference.toFixed(3)}`,
      fmtTime(r.raceTime),
      r.raceStatus,
      r.penalties ? `+${r.penalties}s` : "",
      cost(r.manifest),
      tokens(r.manifest),
    ]);
  }
  return `${head}\nreference lap: ${fmtTime(res.referenceLap)}\n${table(rows)}`;
}

export function table(rows: string[][]): string {
  const w = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(w[i]!)).join(" | ")} |`;
  return [line(rows[0]!), `|${w.map((x) => "-".repeat(x + 2)).join("|")}|`, ...rows.slice(1).map(line)].join(
    "\n",
  );
}

const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

/** Aggregate every event-results.json under a directory. */
export function leaderboard(dir: string): CommandOutput {
  const events: EventResults[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 3 || !existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === "event-results.json") events.push(readJson<EventResults>(p));
    }
  };
  walk(resolve(dir), 0);
  if (!events.length) return { text: `no event-results.json found under ${dir}\n` };
  events.sort((a, b) => a.event.id.localeCompare(b.event.id));
  const totals = new Map<
    string,
    { points: number; events: number; wins: number; cost: number; dnf: number }
  >();
  for (const ev of events) {
    for (const r of ev.rows) {
      const t = totals.get(r.name) ?? { points: 0, events: 0, wins: 0, cost: 0, dnf: 0 };
      if (r.raceStatus === "FINISHED") t.points += POINTS[r.racePosition - 1] ?? 0;
      else t.dnf++;
      t.events++;
      if (r.racePosition === 1 && r.raceStatus === "FINISHED") t.wins++;
      t.cost += r.manifest?.usage?.costUsd ?? 0;
      totals.set(r.name, t);
    }
  }
  const standings = [...totals.entries()].sort(
    (a, b) => b[1].points - a[1].points || a[0].localeCompare(b[0]),
  );
  const rows = [["Pos", "Model", "Points", "Events", "Wins", "DNF", "Total cost"]];
  standings.forEach(([name, t], i) => {
    rows.push([
      String(i + 1),
      name,
      String(t.points),
      String(t.events),
      String(t.wins),
      String(t.dnf),
      t.cost ? `$${t.cost.toFixed(2)}` : "-",
    ]);
  });
  const parts = [
    "# Leaderboard",
    "",
    `Standings (points ${POINTS.join("-")}, finishers only)`,
    "",
    table(rows),
  ];
  for (const ev of events) parts.push("", `## ${ev.event.name}`, "", eventTable(ev));
  const text = `${parts.join("\n")}\n`;
  writeFileSync(join(resolve(dir), "leaderboard.md"), text);
  return { text };
}

export function replayInfo(path: string): CommandOutput {
  const r = readReplay(path);
  const dur = Math.max(...r.cars.map((c) => c.frames.x.length)) / CONTROL_HZ;
  const lines = [
    `${basename(path)}: ${r.header.session.type} on ${r.header.trackId}, ${r.cars.length} cars, ${dur.toFixed(1)} s`,
    `sim ${r.header.simVersion} api ${r.header.apiVersion} seed ${r.header.seed} hash ${r.header.stateHash}`,
    ...r.classification.map((c) => `P${c.position} ${c.name} ${c.status} best ${fmtTime(c.bestLap)}`),
  ];
  return { text: `${lines.join("\n")}\n` };
}

export function listTracks(): CommandOutput {
  const dir = join(repoRoot(), "tracks");
  const ids = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
  const lines = ids.map((id) => {
    const t = loadTrack(id);
    return `${id.padEnd(14)} ${t.name.padEnd(18)} ${(t.length / 1000).toFixed(3)} km`;
  });
  return { text: `${lines.join("\n")}\n` };
}
