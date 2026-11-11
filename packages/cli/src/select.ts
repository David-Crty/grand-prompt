import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fmtTime } from "@bench/sim";
import {
  eventPaths,
  listEventDrivers,
  type Manifest,
  readEvent,
  runRace,
  type Selection,
  type SelectionCandidate,
  table,
} from "./event.js";
import { readJson, writeJson } from "./load.js";
import type { CommandOutput } from "./session.js";

export const SELECTION_RULE =
  "most valid laps on the practice circuits, then the lowest total time of those laps, then the earlier event";

/** Best first, by `SELECTION_RULE`; `candidates` must be in source-event order. */
export function rankCandidates(candidates: SelectionCandidate[]): SelectionCandidate[] {
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.validLaps - a.c.validLaps || a.c.totalTime - b.c.totalTime || a.i - b.i)
    .map((x) => x.c);
}

/** A candidate's score from its lap on each practice circuit (null: deleted lap or retirement). */
export function scoreCandidate(event: string, laps: Record<string, number | null>): SelectionCandidate {
  const valid = Object.values(laps).filter((t): t is number => t !== null);
  return { event, laps, validLaps: valid.length, totalTime: valid.reduce((a, b) => a + b, 0) };
}

/**
 * `drivers/<target>/`: for each model, the driver of the source event that did best on the model's
 * own practice circuits (`SELECTION_RULE`). The circuits it never saw play no part in the choice.
 * Each source event's drivers are raced afresh on those circuits; the chosen `driver.js` is copied
 * byte for byte and its manifest gets a `selection` with every candidate's laps.
 */
export async function selectEvent(target: string, sources: string[]): Promise<CommandOutput> {
  if (sources.length < 2) throw new Error("select: --input needs at least two events");
  if (new Set(sources).size !== sources.length) throw new Error("select: an --input event is listed twice");
  if (sources.includes(target)) throw new Error(`select: '${target}' is both --output and --input`);
  const targetDir = eventPaths(target).drivers;
  if (existsSync(targetDir)) throw new Error(`select: drivers/${target}/ already exists`);
  const events = sources.map(readEvent);
  const seeds = new Set(events.map((e) => e.seed));
  if (seeds.size !== 1)
    throw new Error(`select: the source events have different seeds (${[...seeds].join(", ")})`);

  type Entry = { event: string; path: string; manifest: Manifest; tracks: string[] };
  const bySlug = new Map<string, Entry[]>();
  for (const source of sources)
    for (const d of listEventDrivers(source)) {
      const mPath = join(d.path, "..", "manifest.json");
      if (!existsSync(mPath)) throw new Error(`select: ${source}/${d.slug} has no manifest.json`);
      const manifest = readJson<Manifest>(mPath);
      const tracks = manifest.settings?.practiceTracks;
      if (!Array.isArray(tracks) || !tracks.length)
        throw new Error(`select: ${source}/${d.slug} records no practice circuits`);
      const list = bySlug.get(d.slug) ?? [];
      list.push({ event: source, path: d.path, manifest, tracks: tracks.map(String) });
      bySlug.set(d.slug, list);
    }
  for (const [slug, list] of bySlug) {
    const first = list[0]!.tracks.join(",");
    const other = list.find((e) => e.tracks.join(",") !== first);
    if (other)
      throw new Error(`select: ${slug} practised on ${first} in one event, ${other.tracks} in another`);
  }

  const laps = new Map<string, number | null>();
  const key = (event: string, slug: string, track: string) => `${event}/${slug}/${track}`;
  for (const event of events) {
    const list = listEventDrivers(event.id);
    const tracks = new Set(
      list.flatMap((d) => bySlug.get(d.slug)!.find((e) => e.event === event.id)!.tracks),
    );
    for (const track of [...tracks].sort()) {
      const out = await runRace(event, list, track);
      for (const c of out.results.classification) laps.set(key(event.id, c.id, track), c.lapTime);
    }
  }

  mkdirSync(targetDir, { recursive: true });
  writeJson(join(targetDir, "event.json"), { name: target, seed: events[0]!.seed });
  const rows = [["Model", "Chosen", ...sources]];
  for (const slug of [...bySlug.keys()].sort()) {
    const list = bySlug.get(slug)!;
    const candidates = list.map((e) =>
      scoreCandidate(
        e.event,
        Object.fromEntries(e.tracks.map((t) => [t, laps.get(key(e.event, slug, t)) ?? null])),
      ),
    );
    const best = rankCandidates(candidates)[0]!;
    const chosen = list.find((e) => e.event === best.event)!;
    const dir = join(targetDir, slug);
    mkdirSync(dir, { recursive: true });
    copyFileSync(chosen.path, join(dir, basename(chosen.path)));
    const selection: Selection = { event: best.event, rule: SELECTION_RULE, candidates };
    writeJson(join(dir, "manifest.json"), { ...chosen.manifest, selection });
    rows.push([
      chosen.manifest.model,
      best.event,
      ...sources.map((s) => {
        const c = candidates.find((x) => x.event === s);
        return c
          ? `${c.validLaps}/${chosen.tracks.length} ${fmtTime(c.validLaps ? c.totalTime : null)}`
          : "-";
      }),
    ]);
  }
  return {
    text: `select ${target} from ${sources.join(", ")}: valid practice laps, then total time\n${table(rows)}\nfiles: drivers/${target}/\n`,
  };
}
