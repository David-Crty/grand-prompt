import type { CarFrames, CarResult, SessionConfig, SimEvent } from "./race.js";
import type { ClassifiedResult } from "./session.js";
import type { TrackData } from "./track/track.js";

/** See docs/REPLAY_FORMAT.md. */
export interface Replay {
  format: "bench-replay";
  formatVersion: 1;
  header: ReplayHeader;
  track: TrackData;
  cars: ReplayCar[];
  classification: ClassifiedResult[];
}

export interface ReplayHeader {
  simVersion: string;
  apiVersion: string;
  ddkVersion: string;
  trackId: string;
  trackHash: string;
  carId: string;
  carHash: string;
  seed: number;
  session: SessionConfig;
  frameRate: number;
  stateHash: string;
  car: { length: number; width: number; wheelbase: number };
  /** Run-up before the line: its length in seconds (the lap clock starts at `time`) and the speed at the line. */
  launch: { time: number; speed: number };
  /** Optional reference lap (house driver) for "gap to reference". */
  referenceLap?: number;
}

export interface ReplayCar {
  id: string;
  name: string;
  color: string;
  driverHash: string;
  frames: CarFrames;
  events: SimEvent[];
  result: CarResult;
}

const PRECISION: Record<keyof CarFrames, number> = {
  x: 100,
  y: 100,
  yaw: 10000,
  speed: 100,
  steer: 1000,
  throttle: 1000,
  brake: 1000,
  surface: 1,
  lap: 1,
  s: 100,
};

/** Round frames for storage. Hashes are computed on full-precision state before this. */
export function encodeFrames(f: CarFrames): CarFrames {
  const out = {} as CarFrames;
  for (const k of Object.keys(PRECISION) as (keyof CarFrames)[]) {
    const p = PRECISION[k];
    out[k] = f[k].map((v) => Math.round(v * p) / p);
  }
  return out;
}

export interface InterpolatedFrame {
  x: number;
  y: number;
  yaw: number;
  speed: number;
  steer: number;
  throttle: number;
  brake: number;
  surface: number;
  lap: number;
  s: number;
  /** true once the car has no more frames (finished / DNF). */
  ended: boolean;
}

/** Sample a car's frames at time t with linear interpolation (yaw unwrapped). */
export function sampleFrames(f: CarFrames, frameRate: number, t: number): InterpolatedFrame {
  const n = f.x.length;
  const u = Math.max(0, t * frameRate);
  const i = Math.min(Math.floor(u), n - 1);
  const j = Math.min(i + 1, n - 1);
  const a = i === j ? 0 : u - i;
  const lerp = (arr: number[]) => arr[i]! + (arr[j]! - arr[i]!) * a;
  let dyaw = f.yaw[j]! - f.yaw[i]!;
  if (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  else if (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  return {
    x: lerp(f.x),
    y: lerp(f.y),
    yaw: f.yaw[i]! + dyaw * a,
    speed: lerp(f.speed),
    steer: lerp(f.steer),
    throttle: lerp(f.throttle),
    brake: lerp(f.brake),
    surface: f.surface[i]!,
    lap: f.lap[i]!,
    s: f.s[i]!,
    ended: u >= n - 1,
  };
}

export function replayDuration(r: Replay): number {
  let max = 0;
  for (const c of r.cars) max = Math.max(max, (c.frames.x.length - 1) / r.header.frameRate);
  return max;
}
