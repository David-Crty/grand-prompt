import type { ToastKind } from "@bench/ui/react";
import { type Corner, whereOnLap } from "./corners.js";
import { formatLapTime, kmh } from "./format.js";
import { type CarIndex, progressAt, sampleCar } from "./frames.js";

export type MessageKind =
  | "start"
  | "fastest"
  | "deleted"
  | "penalty"
  | "warning"
  | "crash"
  | "impact"
  | "finish"
  | "dnf"
  | "strike";

export interface RaceMessage {
  t: number;
  /** Empty for messages about the session (the start). */
  carId: string;
  name: string;
  color: string;
  kind: MessageKind;
  text: string;
  lap: number;
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

/** Race-control style feed derived from the cars' events, in time order. */
export function raceMessages(cars: CarIndex[], corners: Corner[] = [], ghost = true): RaceMessage[] {
  const all = cars.flatMap((c) => c.car.events.map((e) => ({ c, e })));
  all.sort((a, b) => a.e.t - b.e.t);
  const crashed = new Set(all.filter(({ e }) => e.type === "crash").map(({ c }) => c.car.id));
  const out: RaceMessage[] = [];
  if (cars.length > 0)
    out.push({
      t: 0,
      carId: "",
      name: "",
      color: "",
      kind: "start",
      lap: 1,
      text: join("Lights out", `${cars.length} cars`, ghost ? "ghost race" : ""),
    });
  let fastest = Number.POSITIVE_INFINITY;
  let finishers = 0;
  for (const { c, e } of all) {
    const base = { t: e.t, carId: c.car.id, name: c.car.name, color: c.car.color, lap: e.lap };
    // A retirement's lap is the one the car was on (the status event can carry the next lap number).
    const onLap = { ...base, lap: Math.floor(progressAt(c, e.t) / c.trackLength) + 1 };
    switch (e.type) {
      case "lap":
        if (e.detail === "invalid")
          out.push({ ...base, kind: "deleted", text: `Lap ${e.lap} deleted: track limits` });
        else if (e.value != null && e.value < fastest) {
          fastest = e.value;
          out.push({
            ...base,
            kind: "fastest",
            text: `Fastest lap ${formatLapTime(e.value)} · lap ${e.lap}`,
          });
        }
        break;
      case "penalty":
        out.push({
          ...base,
          kind: "penalty",
          text: `${e.value ?? 0}s penalty${e.detail ? `: ${e.detail}` : ""}`,
        });
        break;
      case "warning":
        out.push({ ...base, kind: "warning", text: `Track limits warning ${e.value ?? ""}`.trim() });
        break;
      case "crash":
        out.push({
          ...onLap,
          kind: "crash",
          text: join(`Crashed at ${impactKmh(c, e.value ?? 0)} km/h`, where(c, e.t, corners)),
        });
        break;
      case "impact":
        out.push({ ...base, kind: "impact", text: `Barrier contact at ${kmh(e.value ?? 0)} km/h` });
        break;
      case "strike":
        out.push({ ...base, kind: "strike", text: `Driver code fault${e.detail ? `: ${e.detail}` : ""}` });
        break;
      case "status":
        if (e.detail === "FINISHED") {
          finishers++;
          out.push({
            ...base,
            kind: "finish",
            text: finishers === 1 ? `Chequered flag · ${c.car.name} wins` : `Finished P${finishers}`,
          });
        } else if (e.detail?.startsWith("DNF") && !crashed.has(c.car.id))
          out.push({ ...onLap, kind: "dnf", text: dnfText(e.detail, where(c, e.t, corners)) });
        break;
      default:
        break;
    }
  }
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
  penalty: "warn",
  warning: "warn",
  impact: "warn",
  strike: "warn",
  crash: "dnf",
  dnf: "dnf",
  finish: "finish",
};

const isOut = (m: RaceMessage) => m.kind === "crash" || m.kind === "dnf";

/** How long a message stays on screen at 1×, in replay seconds: retirements and the result stay longest. */
export function toastLife(m: RaceMessage): number {
  return isOut(m) || (m.kind === "finish" && m.text.startsWith("Chequered")) ? 30 : 8;
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
