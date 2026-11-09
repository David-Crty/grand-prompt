import { formatLapTime, kmh } from "./format.js";
import type { CarIndex } from "./frames.js";

export type MessageKind =
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
  carId: string;
  name: string;
  color: string;
  kind: MessageKind;
  text: string;
}

/** Race-control style feed derived from the cars' events, in time order. */
export function raceMessages(cars: CarIndex[]): RaceMessage[] {
  const all = cars.flatMap((c) => c.car.events.map((e) => ({ c, e })));
  all.sort((a, b) => a.e.t - b.e.t);
  const out: RaceMessage[] = [];
  let fastest = Number.POSITIVE_INFINITY;
  for (const { c, e } of all) {
    const base = { t: e.t, carId: c.car.id, name: c.car.name, color: c.car.color };
    switch (e.type) {
      case "lap":
        if (e.detail === "invalid")
          out.push({ ...base, kind: "deleted", text: `Lap ${e.lap} deleted: track limits` });
        else if (e.value != null && e.value < fastest) {
          fastest = e.value;
          out.push({ ...base, kind: "fastest", text: `Fastest lap ${formatLapTime(e.value)}` });
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
        out.push({ ...base, kind: "crash", text: `Crash at ${kmh(e.value ?? 0)} km/h` });
        break;
      case "impact":
        out.push({ ...base, kind: "impact", text: `Barrier contact at ${kmh(e.value ?? 0)} km/h` });
        break;
      case "strike":
        out.push({ ...base, kind: "strike", text: `Driver code fault${e.detail ? `: ${e.detail}` : ""}` });
        break;
      case "status":
        if (e.detail === "FINISHED") out.push({ ...base, kind: "finish", text: "Chequered flag" });
        else if (e.detail?.startsWith("DNF")) out.push({ ...base, kind: "dnf", text: e.detail });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Messages shown at time t: the last `max` within `window` seconds. */
export function recentMessages(msgs: RaceMessage[], t: number, window: number, max = 3): RaceMessage[] {
  const out: RaceMessage[] = [];
  for (let k = msgs.length - 1; k >= 0 && out.length < max; k--) {
    const m = msgs[k]!;
    if (m.t > t) continue;
    if (t - m.t > window) break;
    out.push(m);
  }
  return out.reverse();
}
