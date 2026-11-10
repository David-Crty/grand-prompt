import type { Replay } from "@bench/sim";
import type { RaceResults, ResultCar } from "./result-page.js";
import type { EventResults } from "./results.js";
import { raceFileUrl, raceReplayUrl } from "./route.js";

export class ReplayLoadError extends Error {}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Validate the parts of a replay the viewer relies on. Throws ReplayLoadError with a readable reason. */
export function validateReplay(data: unknown): Replay {
  if (typeof data !== "object" || data === null) throw new ReplayLoadError("Not a JSON object");
  const r = data as Partial<Replay>;
  if (r.format !== "bench-replay") throw new ReplayLoadError("Not a bench replay (missing format)");
  if (r.formatVersion !== 1)
    throw new ReplayLoadError(`Unsupported formatVersion ${String(r.formatVersion)}`);
  if (!r.header || !(r.header.frameRate > 0)) throw new ReplayLoadError("Missing header.frameRate");
  if (!r.track || !Array.isArray(r.track.x) || r.track.x.length < 3)
    throw new ReplayLoadError("Missing track");
  if (!Array.isArray(r.cars) || r.cars.length === 0) throw new ReplayLoadError("Replay has no cars");
  for (const c of r.cars) {
    if (!c.frames || !Array.isArray(c.frames.x) || c.frames.x.length === 0)
      throw new ReplayLoadError(`Car ${c.id} has no frames`);
  }
  if (!Array.isArray(r.classification)) r.classification = [];
  return r as Replay;
}

/** Decode raw bytes (plain or gzipped JSON, detected by magic number) into a Replay. */
export async function decodeReplay(input: ArrayBuffer | Uint8Array): Promise<Replay> {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isGzip(bytes)) bytes = await gunzip(bytes);
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new ReplayLoadError(`Invalid JSON: ${(e as Error).message}`);
  }
  return validateReplay(data);
}

export async function fetchReplay(url: string, fetchFn: typeof fetch = fetch): Promise<Replay> {
  const res = await fetchFn(url);
  if (!res.ok) throw new ReplayLoadError(`HTTP ${res.status} fetching ${url}`);
  // The static host answers a missing file with the app's own page.
  if (res.headers.get("content-type")?.includes("text/html"))
    throw new ReplayLoadError(`No replay at ${url}`);
  return decodeReplay(await res.arrayBuffer());
}

/** An event's results sit next to its replay: `/results/races/monaco/r1-medium/replay.json.gz` -> `…/r1-medium/event-results.json`. */
export function eventResultsUrl(replayUrl: string): string | null {
  const m = replayUrl.match(/^(.*)\/replay\.json(\.gz)?(\?.*)?$/);
  return m ? `${m[1]}/event-results.json` : null;
}

/** The event's results and build manifests, or null when they are not published next to the replay. */
export async function fetchEventResults(
  replayUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<EventResults | null> {
  const url = eventResultsUrl(replayUrl);
  if (!url) return null;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const data = (await res.json()) as EventResults;
    return Array.isArray(data?.rows) ? data : null;
  } catch {
    return null;
  }
}

/** A race's classification and builds, for its results page. Throws ReplayLoadError without a classification. */
export async function fetchRaceResults(
  track: string,
  event: string,
  fetchFn: typeof fetch = fetch,
): Promise<RaceResults> {
  const url = raceFileUrl(track, event, "results.json");
  const res = await fetchFn(url);
  if (!res.ok) throw new ReplayLoadError(`HTTP ${res.status} fetching ${url}`);
  if (res.headers.get("content-type")?.includes("text/html"))
    throw new ReplayLoadError(`No results at ${url}`);
  let data: { classification?: unknown };
  try {
    data = (await res.json()) as { classification?: unknown };
  } catch (e) {
    throw new ReplayLoadError(`Invalid JSON at ${url}: ${(e as Error).message}`);
  }
  if (!Array.isArray(data?.classification)) throw new ReplayLoadError(`No classification at ${url}`);
  return {
    event,
    classification: data.classification as ResultCar[],
    results: await fetchEventResults(raceReplayUrl(track, event), fetchFn),
  };
}
