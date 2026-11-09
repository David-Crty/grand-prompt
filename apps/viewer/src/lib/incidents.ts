/**
 * Why a car went out, in plain words, from its own frames: reproducible, so the same replay always gives the
 * same sentence. Rules, in the order they can happen: losing the rear (under throttle: power oversteer; under
 * braking: a brake lock), coming to rest, driving the wrong way, rejoining, and the end itself (barrier,
 * driver program failure, stall, time up).
 */
import type { TrackData } from "@bench/sim";
import { formatClock, kmh } from "@bench/ui";
import { type Corner, whereOnLap } from "./corners.js";
import type { CarIndex } from "./frames.js";
import { impactKmh } from "./messages.js";

export type IncidentCause =
  | "power-oversteer"
  | "brake-lock"
  | "wrong-way"
  | "barrier-contact"
  | "ecu-failure"
  | "stalled"
  | "time-up";

export interface Spin {
  /** When the rear let go (slip past 15 degrees), and the speed then. */
  t: number;
  kmh: number;
  /** Mean throttle and brake over the half second before. */
  throttle: number;
  brake: number;
  where: string;
}

export interface Incident {
  carId: string;
  /** When the car went out. */
  t: number;
  /** "Turn 2 exit". */
  where: string;
  /** The corner it happened at or before, for short labels ("T2"). */
  corner: number | null;
  impactKmh: number | null;
  causes: IncidentCause[];
  /** Short cause for the card: "Power oversteer, then wrong way". */
  cause: string;
  sentence: string;
  /** Start of the incident replay: a moment before it began. */
  replayFrom: number;
  x: number;
  y: number;
  spins: Spin[];
  /** Speed and inputs from replayFrom to the end, about 120 samples, for the card's trace. */
  window: { t: number[]; speedKmh: number[]; throttle: number[]; brake: number[] };
  error?: string;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (d: number) => (d * Math.PI) / 180;

/** Slip above this is losing the rear; above SPUN the car has turned round. */
export const SLIP_LOST = deg(15);
export const SLIP_SPUN = deg(70);
/** Heading more than this from the track's direction, while moving, is the wrong way. */
export const WRONG_WAY = deg(120);
/** Seconds before the rear let go that the incident replay starts. */
export const REPLAY_LEAD = 2.5;
/** Under this speed (m/s) a car has come to rest. */
export const REST_SPEED = 2;
/** A spin is over once the car has run straight this long (s). */
export const STRAIGHT_S = 1.5;

/** Per-frame slip angle (yaw against the direction of travel), and track-relative heading. */
function motion(c: CarIndex, track: Pick<TrackData, "heading" | "spacing">) {
  const f = c.car.frames;
  const n = f.x.length;
  const slip = new Float64Array(n);
  const rel = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = f.x[b]! - f.x[a]!;
    const dy = f.y[b]! - f.y[a]!;
    slip[i] = Math.hypot(dx, dy) > 1e-3 ? wrap(f.yaw[i]! - Math.atan2(dy, dx)) : 0;
    const k = Math.round(f.s[i]! / track.spacing) % track.heading.length;
    rel[i] = wrap(f.yaw[i]! - track.heading[k]!);
  }
  return { slip, rel };
}

/** Runs of frames where `test` holds for at least `minS` seconds: [first, last] frame indices. */
function runs(n: number, rate: number, minS: number, test: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && test(i);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if ((i - start) / rate >= minS) out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

function placePhrase(where: string): string {
  if (where.endsWith(" exit")) return `on the exit of ${where.slice(0, -5)}`;
  if (where.startsWith("before ")) return where;
  return where ? `in ${where}` : "";
}

const join = (...parts: string[]) => parts.filter(Boolean).join(" ");

/** The incident that ended a car's lap, or null if it finished or is still running at the end. */
export function analyseIncident(
  c: CarIndex,
  track: Pick<TrackData, "heading" | "spacing">,
  corners: Corner[],
): Incident | null {
  const out = c.statuses.find((s) => s.status.startsWith("DNF") || s.status === "TIME UP");
  if (!out) return null;
  const f = c.car.frames;
  const rate = c.frameRate;
  const n = f.x.length;
  const end = Math.min(n - 1, Math.round(out.t * rate));
  const { slip, rel } = motion(c, track);
  const at = (i: number) => whereOnLap(corners, f.s[i]!, c.trackLength)?.text ?? "";
  const cornerAt = (i: number) => whereOnLap(corners, f.s[i]!, c.trackLength)?.corner ?? null;
  const mean = (arr: ArrayLike<number>, i: number) => {
    const a = Math.max(0, i - Math.round(rate / 2));
    let sum = 0;
    for (let k = a; k <= i; k++) sum += arr[k]!;
    return sum / (i - a + 1);
  };

  // Spins: the car turns past 70 degrees of slip at speed; the onset is where slip first passed 15 degrees.
  // One spin lasts until the car runs straight again for STRAIGHT_S, or stops.
  const spins: Spin[] = [];
  const stopped = (k: number) => f.speed[k]! < REST_SPEED;
  let i = 0;
  while (i <= end) {
    if (Math.abs(slip[i]!) > SLIP_SPUN && f.speed[i]! > 8) {
      let k = i;
      while (k > 0 && Math.abs(slip[k - 1]!) > SLIP_LOST && i - k < rate * 3) k--;
      spins.push({
        t: k / rate,
        kmh: kmh(f.speed[k]!),
        throttle: mean(f.throttle, k),
        brake: mean(f.brake, k),
        where: at(k),
      });
      let straight = 0;
      while (i <= end && !stopped(i) && straight < STRAIGHT_S * rate) {
        straight = Math.abs(slip[i]!) < SLIP_LOST && f.speed[i]! > 5 ? straight + 1 : 0;
        i++;
      }
      continue;
    }
    i++;
  }

  // What happened after each spin: coming to rest, driving the wrong way, rejoining. Times in frames.
  type Step = { k: number; text: string };
  const steps: Step[] = [];
  const wrongRuns = runs(
    end + 1,
    rate,
    1,
    (k) =>
      k / rate >= (spins[0]?.t ?? out.t) &&
      f.speed[k]! > 3 &&
      Math.abs(slip[k]!) < deg(45) &&
      Math.abs(rel[k]!) > WRONG_WAY,
  );
  const wrongS = wrongRuns.reduce((acc, [p, q]) => acc + (q - p + 1) / rate, 0);
  spins.forEach((sp, n) => {
    const how =
      sp.brake > 0.5 && sp.brake >= sp.throttle
        ? "under braking"
        : sp.throttle > 0.85
          ? "under full throttle"
          : sp.throttle > 0.3
            ? "under throttle"
            : "";
    const k0 = Math.round(sp.t * rate);
    steps.push({
      k: k0,
      text:
        n === 0
          ? join("Spun", how, placePhrase(sp.where), `at ${sp.kmh} km/h`)
          : join("lost the rear again", how, placePhrase(sp.where)),
    });
    const until = Math.min(end, Math.round((spins[n + 1]?.t ?? out.t) * rate));
    let rest = -1;
    for (let k = k0; k < until; k++)
      if (stopped(k)) {
        rest = k;
        break;
      }
    if (rest < 0) return;
    const facing = Math.abs(rel[rest]!) > WRONG_WAY ? " facing the wrong way" : "";
    const grass = !facing && f.surface[rest]! >= 2 ? " on the grass" : "";
    steps.push({ k: rest, text: `came to rest${facing}${grass}` });
    for (let k = rest; k < until; k++)
      if (f.surface[k]! <= 1 && Math.abs(rel[k]!) < deg(45) && f.speed[k]! > 10) {
        steps.push({ k, text: `rejoined at ${formatClock(k / rate)}` });
        break;
      }
  });
  if (wrongRuns.length)
    steps.push({ k: wrongRuns[0]![0], text: `drove the wrong way for ${Math.round(wrongS)} s` });
  steps.sort((p, q) => p.k - q.k);

  const detail = out.status;
  const crashed = detail.startsWith("DNF: CRASHED");
  const ecu = detail.startsWith("DNF: ECU");
  const stalled = detail.startsWith("DNF: STALLED");
  const crash = c.car.events.find((e) => e.type === "crash");
  const impact = crashed ? impactKmh(c, crash?.value ?? f.speed[end]!) : null;

  const causes: IncidentCause[] = [];
  for (const sp of spins) {
    const kind: IncidentCause = sp.brake > 0.5 && sp.brake >= sp.throttle ? "brake-lock" : "power-oversteer";
    if (!causes.includes(kind)) causes.push(kind);
  }
  if (wrongS > 0) causes.push("wrong-way");
  if (crashed) causes.push("barrier-contact");
  if (ecu) causes.push("ecu-failure");
  if (stalled) causes.push("stalled");
  if (detail === "TIME UP") causes.push("time-up");

  const ending = crashed
    ? `hit the barrier at ${impact} km/h`
    : ecu
      ? "the driver program failed"
      : stalled
        ? "stalled"
        : "ran out of time";
  const body = steps.length ? `${steps.map((x) => x.text).join(", ")} and ${ending}` : ending;
  const sentence = `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
  const first = spins[0]?.t ?? out.t;

  const errorText = ecu ? (detail.match(/\((.*)\)/)?.[1] ?? c.car.result.errors?.[0]) : undefined;
  const label = (k: IncidentCause) =>
    ({
      "power-oversteer": "power oversteer",
      "brake-lock": "brake lock",
      "wrong-way": "wrong way",
      "barrier-contact": "",
      "ecu-failure": "driver program failure",
      stalled: "stalled",
      "time-up": "time up",
    })[k];
  const named = causes.map(label).filter(Boolean);
  let cause = named.length === 0 ? "barrier" : named.join(", then ");
  if (spins.length > 1 && named.length === 1) cause = `${named[0]}, twice`;
  cause = cause.charAt(0).toUpperCase() + cause.slice(1);

  const replayFrom = Math.max(0, Math.floor(first - REPLAY_LEAD));
  const place = spins[0]?.where ?? at(end);
  const w: Incident["window"] = { t: [], speedKmh: [], throttle: [], brake: [] };
  const a = Math.round(replayFrom * rate);
  const samples = 120;
  for (let k = 0; k <= samples; k++) {
    const j = Math.min(end, Math.round(a + ((end - a) * k) / samples));
    w.t.push(j / rate);
    w.speedKmh.push(f.speed[j]! * 3.6);
    w.throttle.push(f.throttle[j]!);
    w.brake.push(f.brake[j]!);
  }
  return {
    carId: c.car.id,
    t: out.t,
    where: place || "On the lap",
    corner: cornerAt(spins[0] ? Math.round(spins[0].t * rate) : end),
    impactKmh: impact,
    causes,
    cause,
    sentence,
    replayFrom,
    x: f.x[end]!,
    y: f.y[end]!,
    spins,
    window: w,
    ...(errorText ? { error: errorText } : {}),
  };
}

export function analyseIncidents(
  cars: CarIndex[],
  track: Pick<TrackData, "heading" | "spacing">,
  corners: Corner[],
): Incident[] {
  return cars.flatMap((c) => analyseIncident(c, track, corners) ?? []).sort((a, b) => a.t - b.t);
}

/** The card's band: "DNF · Crashed", "DNF · Driver program failure", "DNF · Stalled" or "Time up". */
export function incidentTitle(inc: Pick<Incident, "causes">): string {
  if (inc.causes.includes("ecu-failure")) return "DNF · Driver program failure";
  if (inc.causes.includes("stalled")) return "DNF · Stalled";
  if (inc.causes.includes("time-up")) return "Time up";
  return "DNF · Crashed";
}
