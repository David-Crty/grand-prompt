/**
 * How a car went out: the sim's own status and events, and where the car was at that moment. Nothing is
 * inferred from the driving before it, so the card states only what the sim recorded.
 */
import { type Corner, whereOnLap } from "./corners.js";
import type { CarIndex } from "./frames.js";
import { impactKmh } from "./messages.js";

export type IncidentKind = "crashed" | "ecu-failure" | "stalled" | "time-up";

export interface Incident {
  carId: string;
  kind: IncidentKind;
  /** When the car went out. */
  t: number;
  /** "Turn 2 exit", where the car was when it went out. */
  where: string;
  /** The corner it went out at or before, for short labels ("T2"). */
  corner: number | null;
  impactKmh: number | null;
  /** Start of the incident replay. */
  replayFrom: number;
  x: number;
  y: number;
  /** The driver program's error, for an ECU failure. */
  error?: string;
}

/** Seconds before the car went out that the incident replay starts. */
export const REPLAY_LEAD = 10;

function kindOf(status: string): IncidentKind {
  if (status.startsWith("DNF: CRASHED")) return "crashed";
  if (status.startsWith("DNF: ECU")) return "ecu-failure";
  if (status.startsWith("DNF: STALLED")) return "stalled";
  return "time-up";
}

/** The incident that ended a car's lap, or null if it finished or is still running at the end. */
export function analyseIncident(c: CarIndex, corners: Corner[]): Incident | null {
  const out = c.statuses.find((s) => s.status.startsWith("DNF") || s.status === "TIME UP");
  if (!out) return null;
  const f = c.car.frames;
  const end = Math.min(f.x.length - 1, Math.round(out.t * c.frameRate));
  const kind = kindOf(out.status);
  const place = whereOnLap(corners, f.s[end]!, c.trackLength);
  const crash = c.car.events.find((e) => e.type === "crash");
  const error =
    kind === "ecu-failure" ? (out.status.match(/\((.*)\)/)?.[1] ?? c.car.result.errors?.[0]) : undefined;
  return {
    carId: c.car.id,
    kind,
    t: out.t,
    where: place?.text || "On the lap",
    corner: place?.corner ?? null,
    impactKmh: kind === "crashed" ? impactKmh(c, crash?.value ?? f.speed[end]!) : null,
    replayFrom: Math.max(0, Math.floor(out.t - REPLAY_LEAD)),
    x: f.x[end]!,
    y: f.y[end]!,
    ...(error ? { error } : {}),
  };
}

export function analyseIncidents(cars: CarIndex[], corners: Corner[]): Incident[] {
  return cars.flatMap((c) => analyseIncident(c, corners) ?? []).sort((a, b) => a.t - b.t);
}

const TITLES: Record<IncidentKind, string> = {
  crashed: "DNF · Crashed",
  "ecu-failure": "DNF · Driver program failure",
  stalled: "DNF · Stalled",
  "time-up": "Time up",
};

/** The card's band: "DNF · Crashed", "DNF · Driver program failure", "DNF · Stalled" or "Time up". */
export function incidentTitle(inc: Pick<Incident, "kind">): string {
  return TITLES[inc.kind];
}

/** Impact speed for the card, "–" when the car did not hit anything. */
export const impactText = (inc: Pick<Incident, "impactKmh">) =>
  inc.impactKmh !== null ? `${inc.impactKmh} km/h` : "–";

/** The card's countdown at replay time `t`: "Out in 3.2 s", then "Out 1.0 s ago". */
export function replayCountdown(inc: Pick<Incident, "t">, t: number): { k: string; v: string } {
  const dt = inc.t - t;
  return dt > 0 ? { k: "Out in", v: `${dt.toFixed(1)} s` } : { k: "Out", v: `${(-dt).toFixed(1)} s ago` };
}
