import type { Replay } from "@bench/sim";

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
  return decodeReplay(await res.arrayBuffer());
}
