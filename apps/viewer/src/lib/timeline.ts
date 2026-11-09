import type { Entry, TimelineMarker } from "@bench/ui";
import type { CarIndex } from "./frames.js";
import type { RaceMessage } from "./messages.js";

/** Clicking a marker or stepping to it lands this many seconds before the event, to see it coming. */
export const MARKER_LEAD = 3;

/**
 * Timeline markers from the race messages: the start, each new fastest lap, warnings and penalties,
 * retirements and the chequered flag. Barrier contacts are left out: there can be dozens.
 */
export function timelineMarkers(messages: RaceMessage[], entries: Map<string, Entry>): TimelineMarker[] {
  const code = (id: string) => entries.get(id)?.code ?? id;
  const out: TimelineMarker[] = [];
  for (const m of messages) {
    const ids = m.carId ? [m.carId] : [];
    switch (m.kind) {
      case "start":
        out.push({ t: m.t, kind: "start", label: "Start", carIds: ids });
        break;
      case "fastest":
        out.push({ t: m.t, kind: "fastest", label: `${code(m.carId)} ${m.text}`, carIds: ids });
        break;
      case "deleted":
      case "penalty":
      case "warning":
      case "strike":
        out.push({ t: m.t, kind: "warn", label: `${code(m.carId)} ${m.text}`, carIds: ids });
        break;
      case "crash":
      case "dnf":
        out.push({ t: m.t, kind: "dnf", label: `${code(m.carId)} out · Lap ${m.lap}`, carIds: ids });
        break;
      case "finish":
        if (m.text.startsWith("Chequered"))
          out.push({ t: m.t, kind: "finish", label: "Chequered flag", carIds: ids });
        break;
      default:
        break;
    }
  }
  return out;
}

/** Ticks where the leader started each lap after the first: the winner's lap crossings, finish excluded. */
export function lapTicks(cars: CarIndex[], winnerId: string | null): { t: number; label: string }[] {
  const leader = cars.find((c) => c.car.id === winnerId) ?? cars[0];
  if (!leader) return [];
  const laps = leader.laps.filter((e) => leader.finishTime === null || e.t < leader.finishTime - 1e-6);
  return laps.map((e, k) => ({ t: e.t, label: `L${k + 2}` }));
}
