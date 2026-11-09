import { formatGap, formatLapTime, kmh } from "@bench/ui";
import type { ToastKind } from "@bench/ui/react";
import { type Corner, whereOnLap } from "./corners.js";
import { type CarIndex, sampleCar } from "./frames.js";

export type MessageKind =
  | "start"
  | "fastest"
  | "deleted"
  | "crash"
  | "impact"
  | "finish"
  | "dnf"
  | "strike"
  | "chequered";

export interface RaceMessage {
  t: number;
  /** Empty for messages about the session (the start). */
  carId: string;
  kind: MessageKind;
  text: string;
  /** The phone's shorter wording, when there is one ("Out · before Turn 4"). */
  short?: string;
}

/** "Turn 2" (or "before Turn 4") where the car was at time t; empty without corners. */
function where(c: CarIndex, t: number, corners: Corner[]): string {
  return whereOnLap(corners, sampleCar(c, t).s, c.trackLength)?.text ?? "";
}

const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");

/**
 * Impact speed in km/h. The retirement status carries the sim's own rounding of the exact speed ("hit the
 * barrier at 106 km/h"); the event value is rounded to 0.1 m/s first, so it can read one lower.
 */
export function impactKmh(c: CarIndex, value: number): number {
  const detail = c.statuses.find((s) => s.status.startsWith("DNF"))?.status ?? "";
  const m = detail.match(/at (\d+) km\/h/);
  return m ? Number(m[1]) : kmh(value);
}

/**
 * Race-control style feed derived from the cars' events, in time order. Every car crosses the line at the
 * same instant, so the first valid lap to come in is pole and the others arrive in lap-time order.
 */
export function raceMessages(
  cars: CarIndex[],
  corners: Corner[] = [],
  launch: { time: number; speed: number } | null = null,
): RaceMessage[] {
  const all = cars.flatMap((c) => c.car.events.map((e) => ({ c, e })));
  all.sort((a, b) => a.e.t - b.e.t);
  const crashed = new Set(all.filter(({ e }) => e.type === "crash").map(({ c }) => c.car.id));
  const out: RaceMessage[] = [];
  if (cars.length > 0)
    out.push({
      t: launch?.time ?? 0,
      carId: "",
      kind: "start",
      text: join("Flying lap", `${cars.length} cars`, launch ? `${kmh(launch.speed)} km/h at the line` : ""),
    });
  let pole: { name: string; time: number } | null = null;
  let timed = 0;
  let done = 0;
  let last = 0;
  for (const { c, e } of all) {
    const base = { t: e.t, carId: c.car.id };
    switch (e.type) {
      case "lap":
        if (e.detail === "invalid") out.push({ ...base, kind: "deleted", text: "Lap deleted: track limits" });
        else if (e.value != null) {
          timed++;
          if (!pole) {
            pole = { name: c.car.name, time: e.value };
            out.push({ ...base, kind: "fastest", text: `Pole · ${formatLapTime(e.value)}` });
          } else
            out.push({
              ...base,
              kind: "finish",
              text: join(`P${timed}`, formatLapTime(e.value), formatGap(e.value - pole.time)),
            });
        }
        break;
      case "crash":
        out.push({
          ...base,
          kind: "crash",
          text: join(`Crashed at ${impactKmh(c, e.value ?? 0)} km/h`, where(c, e.t, corners)),
          short: join("Out", where(c, e.t, corners)),
        });
        break;
      case "impact":
        out.push({ ...base, kind: "impact", text: `Barrier contact at ${kmh(e.value ?? 0)} km/h` });
        break;
      case "strike":
        out.push({ ...base, kind: "strike", text: `Driver code fault${e.detail ? `: ${e.detail}` : ""}` });
        break;
      case "status":
        if (e.detail && e.detail !== "RUNNING") {
          done++;
          last = e.t;
        }
        if (e.detail?.startsWith("DNF") && !crashed.has(c.car.id))
          out.push({ ...base, kind: "dnf", text: dnfText(e.detail, where(c, e.t, corners)) });
        break;
      default:
        break;
    }
  }
  if (cars.length > 0 && done === cars.length)
    out.push({
      t: last,
      carId: "",
      kind: "chequered",
      text: pole ? `Chequered flag · ${pole.name} on pole` : "Chequered flag · no valid lap",
    });
  return out;
}

/** "DNF: STALLED" at Turn 3 reads "Stalled · Turn 3"; an ECU failure keeps the driver's error. */
export function dnfText(detail: string, place: string): string {
  const m = detail.match(/^DNF:\s*([^(]+?)\s*(?:\((.*)\))?$/);
  if (!m) return join(detail, place);
  const what = m[1]!.toLowerCase();
  const label = what.charAt(0).toUpperCase() + what.slice(1);
  return join(m[2] ? `${label}: ${m[2]}` : label, place);
}

export const TOAST_KIND: Record<MessageKind, ToastKind> = {
  start: "info",
  fastest: "fastest",
  deleted: "warn",
  impact: "warn",
  strike: "warn",
  crash: "dnf",
  dnf: "dnf",
  finish: "finish",
  chequered: "finish",
};

const isOut = (m: RaceMessage) => m.kind === "crash" || m.kind === "dnf";

/** How long a message stays on screen at 1×, in replay seconds: retirements and the result stay longest. */
export function toastLife(m: RaceMessage): number {
  return isOut(m) || m.kind === "chequered" ? 30 : 8;
}

/**
 * The toasts on screen at time t, oldest first. Each message lives `toastLife` seconds, stretched at high
 * playback speed so it is still readable; a car's warnings in the 3 s before it retires fold into the
 * retirement, which explains them.
 */
export function visibleToasts(msgs: RaceMessage[], t: number, speed: number, max = 3): RaceMessage[] {
  const stretch = Math.max(1, speed / 2);
  const live = msgs.filter((m) => m.t <= t && t - m.t <= toastLife(m) * stretch);
  const folded = live.filter(
    (m) =>
      TOAST_KIND[m.kind] !== "warn" ||
      !msgs.some((o) => isOut(o) && o.carId === m.carId && o.t >= m.t && o.t - m.t <= 3),
  );
  return folded.slice(-max);
}
