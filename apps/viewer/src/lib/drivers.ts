/** The drivers page: one row per model, from the build manifests in its races' `event-results.json`. */

/** Points for the places in one race, every race the same whatever the circuit. */
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1] as const;

/** A car's points in one race: by its place, and only for a valid lap. */
export function racePoints(position: number | null, lapTime: number | null): number {
  if (position == null || lapTime == null) return 0;
  return POINTS[position - 1] ?? 0;
}

export interface DriverUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  wallTimeS?: number;
  practiceRuns?: number;
}

export interface DriverResult {
  track: string;
  trackName: string;
  position: number | null;
  lapTime: number | null;
}

export interface DriverEntry {
  /** The model's folder under `drivers/<event>/`. */
  id: string;
  name: string;
  provider: string | null;
  effort: string | null;
  /** The newest event the model entered, where its build and results come from. */
  event: string;
  usage: DriverUsage | null;
  /** One per race of that event, by circuit name. */
  results: DriverResult[];
  /** Over every race the model ran. */
  points: number;
}

/** The parts of a race's `event-results.json` the drivers page reads. */
export interface EventResultsSource {
  event: { id: string };
  track: string;
  rows: {
    slug: string;
    name: string;
    position?: number | null;
    lapTime?: number | null;
    manifest?: {
      provider?: string;
      usage?: DriverUsage;
      settings?: { effort?: string };
    } | null;
  }[];
}

export function isEventResults(v: unknown): v is EventResultsSource {
  const r = v as Partial<EventResultsSource> | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.event?.id === "string" &&
    typeof r.track === "string" &&
    Array.isArray(r.rows) &&
    r.rows.every((x) => typeof x?.slug === "string" && typeof x.name === "string")
  );
}

export interface StoredRace {
  src: EventResultsSource;
  trackName: string;
  /** Last modification, ms since epoch. */
  time: number;
}

/**
 * One row per model, from the newest event it entered (an event is as new as its newest race), with its result
 * in each race of that event and its points over every race. Sorted by name.
 */
export function summarizeDrivers(races: StoredRace[]): DriverEntry[] {
  const eventTime = new Map<string, number>();
  for (const r of races) eventTime.set(r.src.event.id, Math.max(eventTime.get(r.src.event.id) ?? 0, r.time));
  const ordered = [...races].sort(
    (a, b) =>
      eventTime.get(b.src.event.id)! - eventTime.get(a.src.event.id)! ||
      a.src.event.id.localeCompare(b.src.event.id) ||
      a.trackName.localeCompare(b.trackName),
  );
  const out = new Map<string, DriverEntry>();
  for (const { src, trackName } of ordered) {
    for (const row of src.rows) {
      let d = out.get(row.slug);
      if (!d) {
        d = {
          id: row.slug,
          name: row.name,
          provider: row.manifest?.provider ?? null,
          effort: row.manifest?.settings?.effort ?? null,
          event: src.event.id,
          usage: row.manifest?.usage ?? null,
          results: [],
          points: 0,
        };
        out.set(row.slug, d);
      }
      d.points += racePoints(row.position ?? null, row.lapTime ?? null);
      if (d.event === src.event.id)
        d.results.push({
          track: src.track,
          trackName,
          position: row.position ?? null,
          lapTime: row.lapTime ?? null,
        });
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The standings: by points, then name, each with its place (equal points share it). While results are hidden the
 * rows keep their order by name, which gives nothing away.
 */
export function standings(drivers: DriverEntry[], byPoints: boolean): (DriverEntry & { place: number })[] {
  const sorted = byPoints
    ? [...drivers].sort(
        (a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      )
    : drivers;
  const byPlace = [...drivers].sort((a, b) => b.points - a.points);
  return sorted.map((d) => ({ ...d, place: byPlace.findIndex((x) => x.points === d.points) + 1 }));
}

/** The circuits the drivers raced, in order, for the page's columns. */
export function raceTracks(drivers: DriverEntry[]): { track: string; trackName: string }[] {
  const seen = new Map<string, string>();
  for (const d of drivers) for (const r of d.results) if (!seen.has(r.track)) seen.set(r.track, r.trackName);
  return [...seen]
    .map(([track, trackName]) => ({ track, trackName }))
    .sort((a, b) => a.trackName.localeCompare(b.trackName));
}

/** "CLI default" for the effort a CLI picks itself, the level otherwise. */
export function formatEffort(effort: string | null): string {
  if (!effort) return "–";
  return effort === "cli-default" ? "CLI default" : effort;
}

/** "P3", or "DNF" for a result without a lap. */
export function formatResult(r: Pick<DriverResult, "position" | "lapTime">): string {
  return r.lapTime == null || r.position == null ? "DNF" : `P${r.position}`;
}
