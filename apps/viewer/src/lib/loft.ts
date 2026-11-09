/** A cross-section of a lofted body at station x: a rectangle with optional rounded top. */
export interface Section {
  x: number;
  halfWidth: number;
  bottom: number;
  top: number;
  /** Narrower top edge as a fraction of halfWidth (1 = box, <1 = tapered sides). */
  topScale?: number;
}

export interface IndexedMesh {
  positions: number[];
  indices: number[];
}

/**
 * Closed loft through rectangular sections along +x (three local coords: x forward, y up, z right).
 * Each section has 4 corners: bottom-left, bottom-right, top-right, top-left. Ends are capped.
 */
export function loft(sections: Section[]): IndexedMesh {
  if (sections.length < 2) throw new Error("loft needs at least two sections");
  const positions: number[] = [];
  const indices: number[] = [];
  for (const s of sections) {
    const tw = s.halfWidth * (s.topScale ?? 1);
    positions.push(s.x, s.bottom, -s.halfWidth);
    positions.push(s.x, s.bottom, s.halfWidth);
    positions.push(s.x, s.top, tw);
    positions.push(s.x, s.top, -tw);
  }
  for (let k = 0; k < sections.length - 1; k++) {
    const a = k * 4;
    const b = (k + 1) * 4;
    for (let e = 0; e < 4; e++) {
      const e2 = (e + 1) % 4;
      indices.push(a + e, b + e, b + e2, a + e, b + e2, a + e2);
    }
  }
  const last = (sections.length - 1) * 4;
  indices.push(0, 1, 2, 0, 2, 3);
  indices.push(last, last + 2, last + 1, last, last + 3, last + 2);
  if (sections[sections.length - 1]!.x < sections[0]!.x) {
    for (let k = 0; k < indices.length; k += 3) {
      const tmp = indices[k + 1]!;
      indices[k + 1] = indices[k + 2]!;
      indices[k + 2] = tmp;
    }
  }
  return { positions, indices };
}

/** Car-length based stations for a generic open-wheeler body, origin at the car centre, nose at +x. */
export function openWheelerSections(
  length: number,
  width: number,
): {
  tub: Section[];
  sidepods: Section[];
  engine: Section[];
} {
  const L = length;
  const half = L / 2;
  const w = width / 2;
  const tub: Section[] = [
    { x: half - 0.05, halfWidth: 0.08, bottom: 0.12, top: 0.22, topScale: 0.6 },
    { x: half - 0.6, halfWidth: 0.14, bottom: 0.1, top: 0.33, topScale: 0.7 },
    { x: half * 0.35, halfWidth: 0.24, bottom: 0.06, top: 0.55, topScale: 0.6 },
    { x: half * 0.05, halfWidth: 0.34, bottom: 0.05, top: 0.62, topScale: 0.55 },
    { x: -half * 0.15, halfWidth: 0.34, bottom: 0.05, top: 0.66, topScale: 0.4 },
  ];
  const sidepods: Section[] = [
    { x: half * 0.05, halfWidth: w * 0.78, bottom: 0.06, top: 0.42, topScale: 0.88 },
    { x: -half * 0.35, halfWidth: w * 0.72, bottom: 0.06, top: 0.44, topScale: 0.85 },
    { x: -half * 0.72, halfWidth: w * 0.3, bottom: 0.06, top: 0.36, topScale: 0.7 },
  ];
  const engine: Section[] = [
    { x: -half * 0.15, halfWidth: 0.3, bottom: 0.3, top: 0.92, topScale: 0.35 },
    { x: -half * 0.35, halfWidth: 0.28, bottom: 0.3, top: 0.88, topScale: 0.3 },
    { x: -half * 0.8, halfWidth: 0.14, bottom: 0.2, top: 0.45, topScale: 0.4 },
  ];
  return { tub, sidepods, engine };
}
