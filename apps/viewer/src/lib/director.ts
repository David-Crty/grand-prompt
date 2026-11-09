import type { StandingRow } from "./timing.js";

export type ShotKind = "heli" | "trackside";

export interface Focus {
  primary: string;
  /** The car being chased, framed together with the primary in a battle. */
  secondary: string | null;
  reason: "leader" | "battle" | "solo";
}

export interface Shot extends Focus {
  kind: ShotKind;
  /** Trackside camera index when kind is "trackside". */
  cam: number;
  /** Wall-clock start of the shot (s). */
  start: number;
}

export interface DirectorOptions {
  /** Interval under which two cars count as a battle (s). */
  battleGap: number;
  /** Minimum time a focus is held before switching (wall s). */
  minHold: number;
  heliMax: number;
  tracksideMax: number;
  /** Trackside shots only below this playback speed; faster, cars pass cameras in a blink. */
  tracksideMaxSpeed: number;
}

export const DEFAULT_DIRECTOR: DirectorOptions = {
  battleGap: 1.0,
  minHold: 5,
  heliMax: 11,
  tracksideMax: 6,
  tracksideMaxSpeed: 2,
};

/** The most interesting thing on track: the closest battle near the front, or the leader. */
export function pickFocus(rows: StandingRow[], opts: DirectorOptions = DEFAULT_DIRECTOR): Focus {
  const running = rows.filter((r) => !r.finished && !r.out);
  if (running.length === 0) return { primary: rows[0]?.id ?? "", secondary: null, reason: "solo" };
  const n = rows.length;
  let best: Focus = {
    primary: running[0]!.id,
    secondary: null,
    reason: running.length > 1 ? "leader" : "solo",
  };
  let bestScore = 1;
  for (let k = 1; k < running.length; k++) {
    const r = running[k]!;
    const ahead = running[k - 1]!;
    if (r.interval === null || r.lapsDown > 0 || r.position !== ahead.position + 1) continue;
    if (r.interval >= opts.battleGap) continue;
    const closeness = 1 - r.interval / opts.battleGap;
    const front = 1 - (ahead.position - 1) / Math.max(1, n);
    const score = 0.6 + 1.4 * closeness + 0.6 * front;
    if (score > bestScore) {
      bestScore = score;
      best = { primary: r.id, secondary: ahead.id, reason: "battle" };
    }
  }
  return best;
}

export interface DirectorContext {
  wallTime: number;
  speed: number;
  /** Trackside camera just ahead of a car, or null if none is well placed. */
  nextCam: (carId: string) => number | null;
  /** Whether the car has gone past the camera. */
  camPassed: (cam: number, carId: string) => boolean;
  /** Car chosen by the viewer, which overrides the automatic focus. */
  forced?: string | null;
}

function sameFocus(a: Focus, b: Focus): boolean {
  return a.primary === b.primary && a.secondary === b.secondary;
}

/** Advance the auto-director: keep the shot, change focus, or cut between heli and trackside. */
export function directorStep(
  prev: Shot | null,
  rows: StandingRow[],
  ctx: DirectorContext,
  opts: DirectorOptions = DEFAULT_DIRECTOR,
): Shot {
  const focus: Focus = ctx.forced
    ? { primary: ctx.forced, secondary: null, reason: "solo" }
    : pickFocus(rows, opts);
  const heli = (): Shot => ({ ...focus, kind: "heli", cam: -1, start: ctx.wallTime });
  if (!prev) return heli();
  const elapsed = ctx.wallTime - prev.start;
  const prevRow = rows.find((r) => r.id === prev.primary);
  const prevDead = !ctx.forced && (!prevRow || prevRow.finished || prevRow.out);
  const tracksideOk = ctx.speed <= opts.tracksideMaxSpeed;

  if (prev.kind === "trackside") {
    const done =
      prevDead || !tracksideOk || elapsed >= opts.tracksideMax || ctx.camPassed(prev.cam, prev.primary);
    if (!done) return prev;
    return heli();
  }

  if (prevDead && !sameFocus(prev, focus)) return heli();
  if (!sameFocus(prev, focus) && elapsed >= opts.minHold) {
    return { ...prev, ...focus, start: ctx.wallTime };
  }
  if (elapsed >= opts.heliMax && tracksideOk) {
    const cam = ctx.nextCam(focus.primary);
    if (cam !== null) return { ...focus, kind: "trackside", cam, start: ctx.wallTime };
  }
  return prev;
}
