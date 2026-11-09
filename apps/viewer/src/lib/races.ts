import type { ClassifiedResult, SessionConfig } from "@bench/sim";

/** The fields of a `results.json` (or of a replay's header + classification) a race list needs. */
export interface RaceSource {
  simVersion: string;
  trackId: string;
  session: Pick<SessionConfig, "type" | "laps" | "seed">;
  classification: Pick<
    ClassifiedResult,
    "id" | "name" | "color" | "status" | "position" | "bestLap" | "totalTime" | "finishTime" | "lapsCompleted"
  >[];
}

export interface RaceDriver {
  id: string;
  name: string;
  color: string;
}

export interface RaceEntry {
  /** Directory relative to `results/`, e.g. "race/monaco-001" or "proto-gp-1/race". */
  id: string;
  /** URL the viewer fetches. */
  replay: string;
  /** First path segment: "race", "practice", "demo", or an event id. */
  group: string;
  trackId: string;
  trackName: string;
  type: string;
  laps: number;
  seed: number;
  simVersion: string;
  /** Last modification of the result files, ms since epoch. */
  time: number;
  cars: number;
  finished: number;
  winner: (RaceDriver & { status: string; time: number | null }) | null;
  fastest: (RaceDriver & { time: number }) | null;
  drivers: RaceDriver[];
}

export interface RaceIndex {
  races: RaceEntry[];
}

export function summarizeRace(
  id: string,
  replay: string,
  src: RaceSource,
  opts: { trackName?: string; time: number },
): RaceEntry {
  const cls = [...src.classification].sort((a, b) => a.position - b.position);
  const p1 = cls[0];
  let fastest: RaceEntry["fastest"] = null;
  for (const c of cls) {
    if (c.bestLap != null && (fastest === null || c.bestLap < fastest.time))
      fastest = { id: c.id, name: c.name, color: c.color, time: c.bestLap };
  }
  const type = src.session.type;
  return {
    id,
    replay,
    group: id.split("/")[0]!,
    trackId: src.trackId,
    trackName: opts.trackName ?? src.trackId,
    type,
    laps: src.session.laps,
    seed: src.session.seed,
    simVersion: src.simVersion,
    time: opts.time,
    cars: cls.length,
    finished: cls.filter((c) => c.status === "FINISHED").length,
    winner: p1
      ? {
          id: p1.id,
          name: p1.name,
          color: p1.color,
          status: p1.status,
          time: type === "race" ? (p1.totalTime ?? p1.finishTime) : p1.bestLap,
        }
      : null,
    fastest,
    drivers: cls.map((c) => ({ id: c.id, name: c.name, color: c.color })),
  };
}

/** Newest first, then by id so equal timestamps keep a stable order. */
export function sortRaces(races: RaceEntry[]): RaceEntry[] {
  return [...races].sort((a, b) => b.time - a.time || a.id.localeCompare(b.id));
}

export function filterRaces(races: RaceEntry[], query: string): RaceEntry[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return races;
  return races.filter((r) => {
    const hay = [r.id, r.trackName, r.trackId, r.type, r.group, ...r.drivers.map((d) => d.name)]
      .join(" ")
      .toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/** Local "2026-11-09 10:21". */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "--";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function sessionLabel(r: Pick<RaceEntry, "type" | "laps">): string {
  const unit = r.laps === 1 ? "lap" : "laps";
  if (r.type === "qualify") return `Qualifying · ${r.laps} ${unit}`;
  if (r.type === "practice") return `Practice · ${r.laps} ${unit}`;
  return `Race · ${r.laps} ${unit}`;
}

/** URL of the viewer page for a replay, keeping other query params out. */
export function watchHref(replay: string): string {
  return `?replay=${encodeURIComponent(replay)}`;
}
