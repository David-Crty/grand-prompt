import { Hasher, hashString, stableStringify } from "./math.js";
import {
  type CarEntry,
  type CarResult,
  type CarRun,
  CarSim,
  CONTROL_HZ,
  LAUNCH_TIME,
  launchSpeed,
  type SessionConfig,
} from "./race.js";
import type { Replay, ReplayCar } from "./replay.js";
import { encodeFrames } from "./replay.js";
import type { Track } from "./track/track.js";
import type { CarConfig } from "./types.js";
import { API_VERSION, DDK_VERSION, SIM_VERSION } from "./version.js";

export interface SessionEntry extends CarEntry {
  /** Content hash of the driver's source, recorded with its result. */
  driverHash?: string;
}

export interface ClassifiedResult extends CarResult {
  position: number;
  /** Seconds behind P1, for timed laps only. */
  gap: number | null;
  driverHash: string;
}

export interface SessionResults {
  simVersion: string;
  apiVersion: string;
  ddkVersion: string;
  session: SessionConfig;
  trackId: string;
  trackHash: string;
  carHash: string;
  /** Speed at the line, m/s, the same for every car. */
  launchSpeed: number;
  stateHash: string;
  classification: ClassifiedResult[];
}

export interface SessionOutput {
  results: SessionResults;
  replay: Replay;
  runs: CarRun[];
}

export function carConfigHash(car: CarConfig): string {
  return hashString(stableStringify(car));
}

const RANK: Record<string, number> = {
  FINISHED: 0,
  "TIME UP": 1,
  RUNNING: 1,
  "DNF: STALLED": 2,
  "DNF: CRASHED": 2,
  "DNF: ECU FAILURE": 3,
};

/** Rank cars by valid lap time; cars without one by status, then by distance covered. */
export function classify(results: CarResult[]): CarResult[] {
  const inf = Number.POSITIVE_INFINITY;
  return [...results].sort(
    (a, b) =>
      (a.lapTime ?? inf) - (b.lapTime ?? inf) || RANK[a.status]! - RANK[b.status]! || b.distance - a.distance,
  );
}

/** Run a session in ghost mode: every car alone in its own world, overlaid in the replay. */
export function runSession(
  track: Track,
  car: CarConfig,
  entries: SessionEntry[],
  cfg: SessionConfig,
  opts: { onCar?: (r: CarRun, i: number) => void } = {},
): SessionOutput {
  const runs: CarRun[] = [];
  entries.forEach((e, i) => {
    const sim = new CarSim(track, car, e, cfg);
    const run = sim.run();
    e.runtime.dispose?.();
    runs.push(run);
    opts.onCar?.(run, i);
  });

  const hashes = new Map(entries.map((e) => [e.id, e.driverHash ?? "unknown"]));
  const ordered = classify(runs.map((r) => r.result));
  const leader = ordered[0];
  const classification: ClassifiedResult[] = ordered.map((r, i) => {
    const gap =
      leader && i > 0 && r.lapTime !== null && leader.lapTime !== null ? r.lapTime - leader.lapTime : null;
    return { ...r, position: i + 1, gap, driverHash: hashes.get(r.id)! };
  });

  const h = new Hasher();
  for (const r of runs) h.string(r.result.stateHash);
  const carHash = carConfigHash(car);
  const results: SessionResults = {
    simVersion: SIM_VERSION,
    apiVersion: API_VERSION,
    ddkVersion: DDK_VERSION,
    session: cfg,
    trackId: track.id,
    trackHash: track.hash,
    carHash,
    launchSpeed: launchSpeed(track),
    stateHash: h.digest(),
    classification,
  };

  const cars: ReplayCar[] = runs.map((r, i) => ({
    id: entries[i]!.id,
    name: entries[i]!.name,
    driverHash: hashes.get(entries[i]!.id)!,
    frames: encodeFrames(r.frames),
    events: r.events,
    result: r.result,
  }));
  const replay: Replay = {
    format: "bench-replay",
    formatVersion: 1,
    header: {
      simVersion: SIM_VERSION,
      apiVersion: API_VERSION,
      ddkVersion: DDK_VERSION,
      trackId: track.id,
      trackHash: track.hash,
      carId: car.id,
      carHash,
      seed: cfg.seed,
      session: cfg,
      frameRate: CONTROL_HZ,
      launch: { time: LAUNCH_TIME, speed: results.launchSpeed },
      stateHash: results.stateHash,
      car: { length: car.public.length, width: car.public.width, wheelbase: car.public.wheelbase },
    },
    track: track.toData(),
    cars,
    classification,
  };
  return { results, replay, runs };
}
