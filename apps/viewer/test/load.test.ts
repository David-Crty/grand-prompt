import { describe, expect, it } from "vitest";
import {
  decodeReplay,
  fetchReplay,
  gunzip,
  isGzip,
  ReplayLoadError,
  validateReplay,
} from "../src/lib/load.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

const track = stadiumTrack();
const replay = makeReplay([makeCar(track, { id: "a", speed: 50, laps: 1 })], track, 10);
const json = new TextEncoder().encode(JSON.stringify(replay));

describe("load", () => {
  it("decodes plain and gzipped JSON", async () => {
    const gz = await gzip(json);
    expect(isGzip(gz)).toBe(true);
    expect(isGzip(json)).toBe(false);
    expect(isGzip(new Uint8Array([0x1f]))).toBe(false);
    expect((await gunzip(gz)).length).toBe(json.length);
    const a = await decodeReplay(json);
    const b = await decodeReplay(gz.buffer as ArrayBuffer);
    expect(a.cars[0]!.id).toBe("a");
    expect(b.track.name).toBe("Stadium");
  });
  it("rejects bad input with readable errors", async () => {
    await expect(decodeReplay(new TextEncoder().encode("{oops"))).rejects.toThrow(/Invalid JSON/);
    expect(() => validateReplay(null)).toThrow(ReplayLoadError);
    expect(() => validateReplay({})).toThrow(/format/);
    expect(() => validateReplay({ format: "bench-replay", formatVersion: 2 })).toThrow(/formatVersion 2/);
    expect(() => validateReplay({ format: "bench-replay", formatVersion: 1, header: {} })).toThrow(
      /frameRate/,
    );
    const base = { format: "bench-replay", formatVersion: 1, header: { frameRate: 50 } };
    expect(() => validateReplay({ ...base, track: { x: [1] } })).toThrow(/track/);
    const withTrack = { ...base, track: { x: [1, 2, 3] } };
    expect(() => validateReplay({ ...withTrack, cars: [] })).toThrow(/no cars/);
    expect(() => validateReplay({ ...withTrack, cars: [{ id: "z", frames: { x: [] } }] })).toThrow(
      /z has no frames/,
    );
    const ok = validateReplay({ ...withTrack, cars: [{ id: "z", frames: { x: [0] } }] });
    expect(ok.classification).toEqual([]);
  });
  it("fetches by URL", async () => {
    const okFetch = (async () => new Response(json)) as unknown as typeof fetch;
    expect((await fetchReplay("/x", okFetch)).cars).toHaveLength(1);
    const notFound = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchReplay("/missing", notFound)).rejects.toThrow(/HTTP 404/);
  });
});
