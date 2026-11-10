/** Full scale of the speed ring, km/h. Fixed so a ring reads the same for every car and circuit. */
export const GAUGE_MAX_KMH = 350;

/** How far the drawn steering wheel turns at full lock, degrees. */
export const WHEEL_LOCK_DEG = 120;

/** A point at `deg` degrees clockwise from twelve o'clock. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** An SVG path for the clockwise arc from `a0` to `a1` degrees (a1 > a0, may pass 360). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** The band between radii `rIn` and `rOut` from `a0` to `a1` degrees, as a closed SVG path; "" when empty. */
export function sectorPath(
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  a0: number,
  a1: number,
): string {
  if (!(a1 > a0)) return "";
  const large = a1 - a0 > 180 ? 1 : 0;
  const p = (r: number, a: number) =>
    polar(cx, cy, r, a)
      .map((n) => n.toFixed(2))
      .join(" ");
  return (
    `M${p(rOut, a0)} A${rOut} ${rOut} 0 ${large} 1 ${p(rOut, a1)} ` +
    `L${p(rIn, a1)} A${rIn} ${rIn} 0 ${large} 0 ${p(rIn, a0)} Z`
  );
}

/** The end angle of an arc from `a0` to `a1` filled to fraction `v`. */
export const fillTo = (a0: number, a1: number, v: number) => a0 + (a1 - a0) * clamp01(v);

/** The wheel's rotation for a steer input (positive left), degrees clockwise as SVG rotates. */
export function wheelAngle(steer: number): number {
  const s = Number.isFinite(steer) ? Math.min(1, Math.max(-1, steer)) : 0;
  return s === 0 ? 0 : -s * WHEEL_LOCK_DEG;
}
