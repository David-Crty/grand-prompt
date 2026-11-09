import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fmtTime } from "@bench/sim";
import { loadTrack, readJson, repoRoot, writeJson } from "./load.js";
import { type CommandOutput, loadEntries, rel, runDrivers, writeSession } from "./session.js";

/** `drivers/<event>/event.json`, written by `bench build`. */
export interface EventConfig {
  name?: string;
  /** The circuit, which no model practised on. */
  track: string;
  seed: number;
}

/** `drivers/<event>/<slug>/manifest.json`: how the driver was built. */
export interface Manifest {
  model: string;
  provider?: string;
  mode?: string;
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
  settings?: Record<string, unknown>;
}

export interface EventResultRow {
  slug: string;
  name: string;
  driverHash: string;
  position: number;
  lapTime: number | null;
  status: string;
  stateHash: string;
  manifest: Manifest | null;
}

/** `results/<event>/event-results.json`. */
export interface EventResults {
  event: EventConfig & { id: string; name: string };
  simVersion: string;
  apiVersion: string;
  trackHash: string;
  carHash: string;
  stateHash: string;
  rows: EventResultRow[];
}

export function eventPaths(eventId: string) {
  const root = repoRoot();
  const drivers = join(root, "drivers", eventId);
  return { config: join(drivers, "event.json"), drivers, results: join(root, "results", eventId) };
}

/** `drivers/<event>/<slug>/driver.{js,ts}`, by slug. */
export function listEventDrivers(eventId: string): { slug: string; path: string }[] {
  const dir = eventPaths(eventId).drivers;
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const js = join(dir, d.name, "driver.js");
      return { slug: d.name, path: existsSync(js) ? js : join(dir, d.name, "driver.ts") };
    })
    .filter((d) => existsSync(d.path))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function readEvent(eventId: string): EventResults["event"] {
  const p = eventPaths(eventId).config;
  if (!existsSync(p)) throw new Error(`no event '${eventId}' (looked for ${p})`);
  const ev = readJson<EventConfig>(p);
  return { id: eventId, name: ev.name ?? eventId, track: ev.track, seed: ev.seed };
}

async function runEventSession(eventId: string) {
  const event = readEvent(eventId);
  const list = listEventDrivers(eventId);
  const drivers = await loadEntries(
    list.map((d) => d.path),
    { seed: event.seed },
  );
  return { event, list, out: runDrivers(loadTrack(event.track), drivers, event.seed) };
}

/** The event's flying lap: the replay in `results/<event>/qualify/` and the table in `event-results.json`. */
export async function runEvent(eventId: string): Promise<CommandOutput> {
  const { event, list, out } = await runEventSession(eventId);
  const dir = eventPaths(eventId).results;
  const files = writeSession(join(dir, "qualify"), out);
  const rows = list.map((d): EventResultRow => {
    const c = out.results.classification.find((x) => x.id === d.slug)!;
    const manifest = join(d.path, "..", "manifest.json");
    return {
      slug: d.slug,
      name: c.name,
      driverHash: c.driverHash,
      position: c.position,
      lapTime: c.lapTime,
      status: c.status,
      stateHash: c.stateHash,
      manifest: existsSync(manifest) ? readJson<Manifest>(manifest) : null,
    };
  });
  rows.sort((a, b) => a.position - b.position);
  const res: EventResults = {
    event,
    simVersion: out.results.simVersion,
    apiVersion: out.results.apiVersion,
    trackHash: out.results.trackHash,
    carHash: out.results.carHash,
    stateHash: out.results.stateHash,
    rows,
  };
  writeJson(join(dir, "event-results.json"), res);
  return {
    text: `${eventTable(res)}\nfiles: ${rel(join(dir, "event-results.json"))}, ${rel(files[0]!)}\n`,
    results: out.results,
  };
}

/** Re-run an event and check every state hash against the stored results. */
export async function reproduceEvent(eventId: string): Promise<CommandOutput & { ok: boolean }> {
  const stored = readJson<EventResults>(join(eventPaths(eventId).results, "event-results.json"));
  const { out } = await runEventSession(eventId);
  const lines: string[] = [`reproduce ${eventId}`];
  let ok = true;
  const check = (label: string, a: string, b: string) => {
    const same = a === b;
    ok &&= same;
    lines.push(`${same ? "ok  " : "DIFF"} ${label}: ${b}${same ? "" : ` (stored ${a})`}`);
  };
  if (stored.simVersion !== out.results.simVersion)
    lines.push(`note: stored sim ${stored.simVersion}, running ${out.results.simVersion}`);
  check("session", stored.stateHash, out.results.stateHash);
  for (const row of stored.rows) {
    const c = out.results.classification.find((x) => x.id === row.slug);
    check(`${row.slug} driver`, row.driverHash, c?.driverHash ?? "missing");
    check(`${row.slug} lap`, row.stateHash, c?.stateHash ?? "missing");
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
  if (u?.inputTokens === undefined && u?.outputTokens === undefined) return "-";
  return `${(((u.inputTokens ?? 0) + (u.outputTokens ?? 0)) / 1000).toFixed(0)}k`;
}

export function eventTable(res: EventResults): string {
  const { event } = res;
  const rows = [["Pos", "Model", "Lap", "Status", "Cost", "Tokens"]];
  for (const r of res.rows)
    rows.push([
      String(r.position),
      r.name,
      fmtTime(r.lapTime),
      r.status,
      cost(r.manifest),
      tokens(r.manifest),
    ]);
  return `${event.name} (${event.id}) on ${event.track}, flying lap, seed ${event.seed}\n${table(rows)}`;
}

/** A Markdown table, columns padded to their widest cell. */
export function table(rows: string[][]): string {
  const w = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(w[i]!)).join(" | ")} |`;
  return [line(rows[0]!), `|${w.map((x) => "-".repeat(x + 2)).join("|")}|`, ...rows.slice(1).map(line)].join(
    "\n",
  );
}

export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

/** Standings over every event-results.json under a directory, written to its leaderboard.md. */
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
      const timed = r.lapTime !== null;
      if (timed) t.points += POINTS[r.position - 1] ?? 0;
      else t.dnf++;
      t.events++;
      if (r.position === 1 && timed) t.wins++;
      t.cost += r.manifest?.usage?.costUsd ?? 0;
      totals.set(r.name, t);
    }
  }
  const standings = [...totals.entries()].sort(
    (a, b) => b[1].points - a[1].points || a[0].localeCompare(b[0]),
  );
  const rows = [["Pos", "Model", "Points", "Events", "Wins", "No time", "Total cost"]];
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
    `Standings (points ${POINTS.join("-")}, valid laps only)`,
    "",
    table(rows),
  ];
  for (const ev of events) parts.push("", `## ${ev.event.name}`, "", eventTable(ev));
  const text = `${parts.join("\n")}\n`;
  writeFileSync(join(resolve(dir), "leaderboard.md"), text);
  return { text };
}
