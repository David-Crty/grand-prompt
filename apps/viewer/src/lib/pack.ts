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
}

/** Two cars overlap when closer than this many car lengths. */
export const PACK_LENGTHS = 1.5;

/**
 * Cars chained by distance under `packDistance` form a pack (two or more). Cars that have stopped (retired or
 * finished) are left out: they are not overlapping anyone's run any more.
 */
export function findPacks(cars: PackCar[], packDistance: number): Pack[] {
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
  for (const members of byRoot.values())
    if (members.length > 1) packs.push({ ids: members.map((c) => c.id) });
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

/** Seconds a car must stay in the label pack before it joins the label, and out of it before it leaves. */
export const PACK_JOIN_HOLD = 0.5;
export const PACK_LEAVE_HOLD = 1;

export interface PackHold {
  focusId: string;
  /** Cars under the pack label, whether or not there are enough of them to show it. */
  ids: string[];
  /** Seconds each car has been waiting to join or leave. */
  wait: Record<string, number>;
}

/**
 * The label pack held over time: `raw` is this frame's `labelPack` others. A car changes side only once the
 * change has lasted `PACK_JOIN_HOLD` or `PACK_LEAVE_HOLD` seconds, so a car at the pack distance does not
 * flip its label on and off. A car that stops leaves at once; a new focus (or none before) decides at once.
 */
export function holdPack(
  prev: PackHold | null,
  raw: readonly string[],
  focusId: string,
  alive: ReadonlySet<string>,
  dt: number,
): PackHold {
  if (prev?.focusId !== focusId) return { focusId, ids: raw.filter((id) => alive.has(id)), wait: {} };
  const wait: Record<string, number> = {};
  const ids: string[] = [];
  for (const id of new Set([...prev.ids, ...raw])) {
    if (!alive.has(id) || id === focusId) continue;
    const was = prev.ids.includes(id);
    let keep = raw.includes(id);
    if (keep !== was) {
      const w = (prev.wait[id] ?? 0) + dt;
      if (w < (was ? PACK_LEAVE_HOLD : PACK_JOIN_HOLD)) {
        wait[id] = w;
        keep = was;
      }
    }
    if (keep) ids.push(id);
  }
  return { focusId, ids, wait };
}

/** Where a car is drawn: exactly its replay sample, on the ground. */
export function carPlacement(s: Pick<CarSample, "x" | "y" | "yaw">): {
  position: [number, number, number];
  yaw: number;
} {
  return { position: toThree(s.x, s.y), yaw: s.yaw };
}

/** Most cars a pack label lists before the rest become "+N": desktop, phone. */
export const PACK_CHIPS = { desktop: 6, phone: 4 } as const;

/**
 * The pack label's cars: sorted by code, so a chip keeps its place while the gaps inside the pack change, the
 * first `max` of them, and how many are left out.
 */
export function packChips(
  ids: readonly string[],
  codeOf: (id: string) => string,
  max: number,
): { ids: string[]; hidden: number } {
  const sorted = [...ids].sort((a, b) => codeOf(a).localeCompare(codeOf(b)) || a.localeCompare(b));
  return { ids: sorted.slice(0, max), hidden: Math.max(0, sorted.length - max) };
}
