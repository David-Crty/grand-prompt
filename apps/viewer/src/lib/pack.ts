/**
 * Ghost start. Every car ran its flying lap alone from the same run-up, so the replay overlays cars that never
 * met. Nothing here moves a car: packs only decide which cars are drawn translucent and which labels merge
 * into one, and the start board shows how far each car is past the line.
 */
import { toThree } from "./coords.js";
import type { CarSample } from "./frames.js";

export interface PackCar {
  id: string;
  x: number;
  y: number;
  /** Race distance, for running order. */
  progress: number;
  ended: boolean;
}

export interface Pack {
  /** In running order, front first. */
  ids: string[];
  /** Groups of two or more cars at the same place (within `sameDistance`), in running order. */
  same: string[][];
}

/** Two cars overlap when closer than this many car lengths. */
export const PACK_LENGTHS = 1.5;
/** Cars this close (m) are at the same place: an identical run so far. */
export const SAME_DISTANCE = 0.05;

/**
 * Cars chained by distance under `packDistance` form a pack (two or more). Cars that have stopped (retired or
 * finished) are left out: they are not overlapping anyone's run any more.
 */
export function findPacks(cars: PackCar[], packDistance: number, sameDistance = SAME_DISTANCE): Pack[] {
  const live = cars.filter((c) => !c.ended).sort((a, b) => b.progress - a.progress);
  const group = live.map((_, k) => k);
  const root = (k: number): number => {
    let r = k;
    while (group[r] !== r) r = group[r]!;
    return r;
  };
  for (let a = 0; a < live.length; a++)
    for (let b = a + 1; b < live.length; b++)
      if (Math.hypot(live[a]!.x - live[b]!.x, live[a]!.y - live[b]!.y) < packDistance)
        group[root(b)] = root(a);
  const byRoot = new Map<number, PackCar[]>();
  live.forEach((c, k) => {
    const r = root(k);
    byRoot.set(r, [...(byRoot.get(r) ?? []), c]);
  });
  const packs: Pack[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const same: string[][] = [];
    let run: PackCar[] = [members[0]!];
    const flush = () => {
      if (run.length > 1) same.push(run.map((c) => c.id));
    };
    for (let k = 1; k < members.length; k++) {
      const c = members[k]!;
      const p = run[run.length - 1]!;
      if (Math.abs(p.progress - c.progress) < sameDistance && Math.hypot(p.x - c.x, p.y - c.y) < sameDistance)
        run.push(c);
      else {
        flush();
        run = [c];
      }
    }
    flush();
    packs.push({ ids: members.map((c) => c.id), same });
  }
  return packs.sort((a, b) => b.ids.length - a.ids.length);
}

/**
 * Cars drawn translucent: every member of a pack but one, which stays solid. That is the followed car when it is
 * in the pack, otherwise the front-most car.
 */
export function ghostIds(packs: Pack[], focusId: string): Set<string> {
  const out = new Set<string>();
  for (const p of packs) {
    const solid = p.ids.includes(focusId) ? focusId : p.ids[0]!;
    for (const id of p.ids) if (id !== solid) out.add(id);
  }
  return out;
}

/** A pack big enough to take one label instead of a stack: three or more cars besides the followed one. */
export const PACK_LABEL_MIN = 3;

export function labelPack(packs: Pack[], focusId: string): (Pack & { others: string[] }) | null {
  for (const p of packs) {
    const others = p.ids.filter((id) => id !== focusId);
    if (others.length >= PACK_LABEL_MIN) return { ...p, others };
  }
  return null;
}

/** Where a car is drawn: exactly its replay sample, on the ground. */
export function carPlacement(s: Pick<CarSample, "x" | "y" | "yaw">): {
  position: [number, number, number];
  yaw: number;
} {
  return { position: toThree(s.x, s.y), yaw: s.yaw };
}

// ------------------------------------------------------------------ start board

export interface LaunchRow {
  id: string;
  /** Metres from the line. */
  distance: number;
}

export interface LaunchBoard {
  rows: LaunchRow[];
  /** Right end of the scale (m): at least 60, rounded up to 20. */
  scale: number;
  /** Cars with identical distance so far, two or more per group. */
  same: string[][];
  /** Lead minus last, among running cars (m). */
  spread: number;
}

/** The board stays up for the first 15 s of replay (the run-up and 12 s of the lap), while the field is within 60 m. */
export const START_BOARD_TIME = 15;
export const START_BOARD_SPREAD = 60;

export function launchBoard(cars: { id: string; progress: number; ended: boolean }[]): LaunchBoard {
  const rows = cars
    .map((c) => ({ id: c.id, distance: Math.max(0, c.progress) }))
    .sort((a, b) => b.distance - a.distance);
  const running = cars.filter((c) => !c.ended).map((c) => c.progress);
  const spread = running.length ? Math.max(...running) - Math.min(...running) : 0;
  const lead = rows[0]?.distance ?? 0;
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const k = r.distance.toFixed(1);
    groups.set(k, [...(groups.get(k) ?? []), r.id]);
  }
  return {
    rows,
    scale: Math.max(START_BOARD_SPREAD, Math.ceil(lead / 20) * 20),
    same: [...groups.values()].filter((g) => g.length > 1),
    spread,
  };
}

export function startBoardVisible(t: number, spread: number): boolean {
  return t < START_BOARD_TIME && spread < START_BOARD_SPREAD;
}

/** The pack label's chips: the listed cars in running order, identical positions grouped together. */
export function packGroups(pack: Pack, ids: string[]): string[][] {
  const want = new Set(ids);
  const out: string[][] = [];
  const done = new Set<string>();
  for (const id of pack.ids) {
    if (!want.has(id) || done.has(id)) continue;
    const g = (pack.same.find((s) => s.includes(id)) ?? [id]).filter((x) => want.has(x));
    for (const x of g) done.add(x);
    out.push(g);
  }
  return out;
}
