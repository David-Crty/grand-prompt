import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CarConfig, Controls, DriverRuntime, Telemetry, TrackFile, TrackInfo } from "../src/index.js";
import { Track } from "../src/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));

export function protoRingFile(): TrackFile {
  return JSON.parse(readFileSync(`${root}tracks/proto-ring.json`, "utf8")) as TrackFile;
}

let ring: Track | undefined;
export function protoRing(): Track {
  ring ??= Track.fromFile(protoRingFile());
  return ring;
}

export function protoCar(): CarConfig {
  return JSON.parse(readFileSync(`${root}cars/proto.json`, "utf8")) as CarConfig;
}

/** Closed circle of radius r as a track file. */
export function circleFile(r: number, width = 12, points = 72): TrackFile {
  const pts: [number, number, number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    pts.push([r * Math.cos(a), r * Math.sin(a), width / 2, width / 2]);
  }
  return {
    id: "circle",
    name: "Circle",
    version: 1,
    closed: true,
    points: pts,
    sectors: [1 / 3, 2 / 3],
    runoff: { default: { type: "grass", width: 10 } },
  };
}

/**
 * Stadium: two 400 m straights 36 m apart, joined by 18 m-radius hairpins, driven anticlockwise, so the return
 * straight runs parallel on the left. Gravel on the left from 90% of the lap to 10% (wrapping past the line).
 */
export function hairpinOvalFile(): TrackFile {
  const pts: [number, number, number, number][] = [];
  const straight = 400;
  const r = 18;
  const step = 4;
  for (let x = 0; x < straight; x += step) pts.push([x, 0, 6, 6]);
  for (let a = 0; a < Math.PI; a += step / r)
    pts.push([straight + r * Math.sin(a), r - r * Math.cos(a), 6, 6]);
  for (let x = straight; x > 0; x -= step) pts.push([x, 2 * r, 6, 6]);
  for (let a = 0; a < Math.PI; a += step / r) pts.push([-r * Math.sin(a), r + r * Math.cos(a), 6, 6]);
  return {
    id: "oval",
    name: "Oval",
    version: 1,
    closed: true,
    points: pts,
    sectors: [0.3, 0.6],
    runoff: {
      default: { type: "grass", width: 15 },
      zones: [{ type: "gravel", width: 20, side: "left", from: 0.9, to: 0.1 }],
    },
  };
}

/** Wrap plain functions as a DriverRuntime. */
export function fnDriver(step: (t: Telemetry) => unknown, init?: (track: TrackInfo) => void): DriverRuntime {
  return { init: (track) => init?.(track), step };
}

/** Simple centerline follower used by feature tests (like the baseline driver, but tunable). */
export function follower(
  opts: { speed: number; offset?: (s: number) => number; lookahead?: number } = { speed: 20 },
) {
  let info!: TrackInfo;
  return fnDriver(
    (t): Controls => {
      const N = info.samples.length;
      const ds = info.sampleSpacing;
      const i = Math.floor(t.s / ds) % N;
      const look = opts.lookahead ?? Math.max(8, 0.35 * t.speed + 6);
      const j = (i + Math.round(look / ds)) % N;
      const p = info.samples[j]!;
      const off = opts.offset?.(p.s) ?? 0;
      const tx = p.x - Math.sin(p.heading) * off;
      const ty = p.y + Math.cos(p.heading) * off;
      const alpha = Math.atan2(ty - t.y, tx - t.x) - t.yaw;
      const d = Math.hypot(tx - t.x, ty - t.y);
      const steer = Math.max(-1, Math.min(1, Math.atan2(2 * 3.6 * Math.sin(alpha), d) / 0.35));
      const err = opts.speed - t.speed;
      return {
        throttle: err > 0 ? Math.min(0.5, err * 0.3) : 0,
        brake: err < -1 ? Math.min(1, -err * 0.2) : 0,
        steer,
      };
    },
    (track) => {
      info = track;
    },
  );
}
