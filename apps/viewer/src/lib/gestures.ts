/** Touch gestures on the phone viewer: swipe the scene to change car, pinch to zoom the TV camera. */

/** A horizontal flick: at least 60 px, mostly sideways, under 0.6 s. Swiping left (negative dx) is the next car. */
export function swipeDir(dx: number, dy: number, dtMs: number): 1 | -1 | null {
  if (dtMs > 600 || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return null;
  return dx < 0 ? 1 : -1;
}

/** Zoom factor from two fingers moving from distance `d0` to `d1` (spreading zooms in). */
export function pinchFactor(d0: number, d1: number): number {
  return d0 > 0 && d1 > 0 ? d1 / d0 : 1;
}

/** The next playback speed for the phone's speed button, wrapping round to the slowest. */
export function cycleSpeed(speeds: readonly number[], current: number): number {
  const k = speeds.findIndex((s) => s > current + 1e-9);
  return k < 0 ? speeds[0]! : speeds[k]!;
}
