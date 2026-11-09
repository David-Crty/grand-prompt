/**
 * Corners numbered from the start line, found from the track's curvature, so messages and incident cards can say
 * where something happened ("Turn 2", "before Turn 4") on any circuit without a hand-made list.
 */
export interface Corner {
  n: number;
  sStart: number;
  sEnd: number;
  sApex: number;
  dir: "L" | "R";
  minRadius: number;
}

/** Curvature above 1/180 m is a corner; runs closer than 40 m merge; runs shorter than 15 m are kinks. */
export function detectCorners(
  track: { length: number; spacing: number; curvature: number[] },
  minCurvature = 1 / 180,
  mergeGap = 40,
  minLength = 15,
): Corner[] {
  const sp = track.spacing;
  const runs: [number, number][] = [];
  let cur: [number, number] | null = null;
  track.curvature.forEach((k, i) => {
    const s = i * sp;
    if (Math.abs(k) > minCurvature) {
      if (cur && s - cur[1] <= mergeGap) cur[1] = s;
      else {
        if (cur) runs.push(cur);
        cur = [s, s];
      }
    } else if (cur && s - cur[1] > mergeGap) {
      runs.push(cur);
      cur = null;
    }
  });
  if (cur) runs.push(cur);
  const out: Corner[] = [];
  for (const [a, b] of runs) {
    if (b - a < minLength) continue;
    let kmax = 0;
    for (let i = Math.round(a / sp); i <= Math.round(b / sp); i++) {
      const k = track.curvature[i] ?? 0;
      if (Math.abs(k) > Math.abs(kmax)) kmax = k;
    }
    out.push({
      n: out.length + 1,
      sStart: a,
      sEnd: b,
      sApex: (a + b) / 2,
      dir: kmax > 0 ? "L" : "R",
      minRadius: 1 / Math.abs(kmax),
    });
  }
  return out;
}

/** Past the end of a corner by up to this much is its exit. */
export const EXIT_LENGTH = 80;

/**
 * Where a lap distance is, in words: "Turn 2" inside a corner, "Turn 2 exit" just after it, "before Turn 4"
 * on the run to the next one (wrapping past the line to Turn 1). Null when the circuit has no corners.
 */
export function whereOnLap(
  corners: Corner[],
  s: number,
  length: number,
): { corner: number; text: string } | null {
  if (corners.length === 0) return null;
  const x = ((s % length) + length) % length;
  for (const c of corners) if (x >= c.sStart && x <= c.sEnd) return { corner: c.n, text: `Turn ${c.n}` };
  for (const c of corners)
    if (x > c.sEnd && x - c.sEnd <= EXIT_LENGTH) return { corner: c.n, text: `Turn ${c.n} exit` };
  const next = corners.find((c) => c.sStart > x) ?? corners[0]!;
  return { corner: next.n, text: `before Turn ${next.n}` };
}
