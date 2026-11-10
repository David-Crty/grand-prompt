import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fmtTime } from "@bench/sim";
import { loadTrack, readJson, repoRoot, writeJson } from "./load.js";
import { type CommandOutput, loadEntries, rel, runDrivers, writeSession } from "./session.js";
import { trackIds } from "./tracks.js";

/** `drivers/<event>/event.json`, written by `bench build`: the event races on every circuit. */
export interface EventConfig {
  name?: string;
  seed: number;
}

/** `drivers/<event>/<slug>/manifest.json`: how the driver was built. */
export interface Manifest {
  model: string;
  provider?: string;
  mode?: string;
  promptVersion?: string;
  driverDevelopmentKitVersion?: string;
  simVersion?: string;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
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

/** `results/races/<track>/<event>/event-results.json`: one race of an event. */
export interface EventResults {
  event: EventConfig & { id: string; name: string };
  track: string;
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
  return { config: join(drivers, "event.json"), drivers, races: join(root, "results", "races") };
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
  return { id: eventId, name: ev.name ?? eventId, seed: ev.seed };
}

/** A race's folder under `results/races/`: the circuit, then the event, as in its address on the site. */
export function raceDir(eventId: string, track: string): string {
  return join(track, eventId);
}

/** One race: the drivers are loaded afresh, since a session disposes of their runtimes. */
async function runRace(event: EventResults["event"], list: { path: string }[], track: string) {
  const drivers = await loadEntries(
    list.map((d) => d.path),
    { seed: event.seed },
  );
  return runDrivers(loadTrack(track), drivers, event.seed);
}

/**
 * The event's drivers on every circuit in `tracks/`, or on `track` alone: one flying lap each, in
 * `<out>/<track>/<event>/` (default `results/races/`), with the race's table and build manifests in
 * `event-results.json`.
 */
export async function raceEvent(
  eventId: string,
  opts: { track?: string; out?: string } = {},
): Promise<CommandOutput> {
  const event = readEvent(eventId);
  const list = listEventDrivers(eventId);
  const base = opts.out ? resolve(opts.out) : eventPaths(eventId).races;
  const parts: string[] = [];
  for (const track of opts.track ? [opts.track] : trackIds()) {
    const out = await runRace(event, list, track);
    const dir = join(base, raceDir(eventId, out.results.trackId));
    const files = writeSession(dir, out);
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
      track: out.results.trackId,
      simVersion: out.results.simVersion,
      apiVersion: out.results.apiVersion,
      trackHash: out.results.trackHash,
      carHash: out.results.carHash,
      stateHash: out.results.stateHash,
      rows,
    };
    writeJson(join(dir, "event-results.json"), res);
    parts.push(`${eventTable(res)}\nfiles: ${rel(join(dir, "event-results.json"))}, ${rel(files[0]!)}\n`);
  }
  return { text: parts.join("\n") };
}

/** The stored races of an event under `results/races/`, by track. */
function storedRaces(eventId: string): EventResults[] {
  const base = eventPaths(eventId).races;
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(base, raceDir(eventId, d.name), "event-results.json"))
    .filter((p) => existsSync(p))
    .map((p) => readJson<EventResults>(p))
    .filter((r) => r.event?.id === eventId)
    .sort((a, b) => a.track.localeCompare(b.track));
}

/** Re-run every stored race of an event and check every state hash against it. */
export async function reproduceEvent(eventId: string): Promise<CommandOutput & { ok: boolean }> {
  const stored = storedRaces(eventId);
  if (!stored.length)
    throw new Error(`no races of '${eventId}' under results/races/ (run: bench race ${eventId})`);
  const lines: string[] = [`reproduce ${eventId}`];
  let ok = true;
  const check = (label: string, a: string, b: string) => {
    const same = a === b;
    ok &&= same;
    lines.push(`${same ? "ok  " : "DIFF"} ${label}: ${b}${same ? "" : ` (stored ${a})`}`);
  };
  const event = readEvent(eventId);
  const list = listEventDrivers(eventId);
  for (const race of stored) {
    const out = await runRace(event, list, race.track);
    lines.push(`${race.track}`);
    if (race.simVersion !== out.results.simVersion)
      lines.push(`note: stored sim ${race.simVersion}, running ${out.results.simVersion}`);
    check("race", race.stateHash, out.results.stateHash);
    for (const row of race.rows) {
      const c = out.results.classification.find((x) => x.id === row.slug);
      check(`${row.slug} driver`, row.driverHash, c?.driverHash ?? "missing");
      check(`${row.slug} lap`, row.stateHash, c?.stateHash ?? "missing");
    }
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
  return `${event.name} (${event.id}) on ${res.track}, flying lap, seed ${event.seed}\n${table(rows)}`;
}

/** A Markdown table, columns padded to their widest cell. */
export function table(rows: string[][]): string {
  const w = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => `| ${r.map((c, i) => c.padEnd(w[i]!)).join(" | ")} |`;
  return [line(rows[0]!), `|${w.map((x) => "-".repeat(x + 2)).join("|")}|`, ...rows.slice(1).map(line)].join(
    "\n",
  );
}
