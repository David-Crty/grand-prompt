/**
 * Ghost start. Every car ran its flying lap alone from the same run-up, so the replay overlays cars that never
 * met. Nothing here moves a car: packs only decide which labels merge into one, and the start board shows
 * how far each car is past the line.
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
