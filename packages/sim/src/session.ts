import { Hasher, hashString, stableStringify } from "./math.js";
import {
  type CarEntry,
  type CarResult,
  type CarRun,
  CarSim,
  CONTROL_HZ,
  type SessionConfig,
} from "./race.js";
import type { Replay, ReplayCar } from "./replay.js";
import { encodeFrames } from "./replay.js";
import type { Track } from "./track/track.js";
import type { CarConfig } from "./types.js";
import { API_VERSION, DDK_VERSION, SIM_VERSION } from "./version.js";

export const CAR_COLORS = [
  "#e63946",
  "#2a9d8f",
  "#f4a261",
  "#457b9d",
  "#e9c46a",
  "#9b5de5",
  "#00bbf9",
  "#f15bb5",
];

export interface SessionEntry extends CarEntry {
  color?: string;
  driverHash?: string;
}

export interface ClassifiedResult extends CarResult {
  position: number;
  gap: number | null;
  color: string;
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

/** Rank cars: race by laps then total time; practice/qualify by best lap. */
export function classify(type: SessionConfig["type"], results: CarResult[]): CarResult[] {
  const byBest = (a: CarResult, b: CarResult) =>
    (a.bestLap ?? Number.POSITIVE_INFINITY) - (b.bestLap ?? Number.POSITIVE_INFINITY);
  return [...results].sort((a, b) => {
    if (type !== "race")
      return byBest(a, b) || b.lapsCompleted - a.lapsCompleted || RANK[a.status]! - RANK[b.status]!;
    const ra = RANK[a.status]! === 0 ? 0 : 1;
    const rb = RANK[b.status]! === 0 ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (b.lapsCompleted !== a.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
    if (a.totalTime !== null && b.totalTime !== null) return a.totalTime - b.totalTime;
    return b.distance - a.distance;
  });
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

  const colors = new Map(entries.map((e, i) => [e.id, e.color ?? CAR_COLORS[i % CAR_COLORS.length]!]));
  const hashes = new Map(entries.map((e) => [e.id, e.driverHash ?? "unknown"]));
  const ordered = classify(
    cfg.type,
    runs.map((r) => r.result),
  );
  const leader = ordered[0];
  const classification: ClassifiedResult[] = ordered.map((r, i) => {
    let gap: number | null = null;
    if (leader && i > 0) {
      if (cfg.type === "race") {
        if (r.totalTime !== null && leader.totalTime !== null) gap = r.totalTime - leader.totalTime;
      } else if (r.bestLap !== null && leader.bestLap !== null) gap = r.bestLap - leader.bestLap;
    }
    return { ...r, position: i + 1, gap, color: colors.get(r.id)!, driverHash: hashes.get(r.id)! };
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
    stateHash: h.digest(),
    classification,
  };

  const cars: ReplayCar[] = runs.map((r, i) => ({
    id: entries[i]!.id,
    name: entries[i]!.name,
    color: colors.get(entries[i]!.id)!,
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
      stateHash: results.stateHash,
      car: { length: car.public.length, width: car.public.width, wheelbase: car.public.wheelbase },
    },
    track: track.toData(),
    cars,
    classification,
  };
  return { results, replay, runs };
}
