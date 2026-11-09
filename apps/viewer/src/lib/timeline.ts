import type { Entry, TimelineMarker } from "@bench/ui";
import type { RaceMessage } from "./messages.js";

/** Clicking a marker or stepping to it lands this many seconds before the event, to see it coming. */
export const MARKER_LEAD = 3;

/**
 * Timeline markers from the race messages: the line, pole, deleted laps and code faults, retirements and the
 * chequered flag. Barrier contacts and the other timed laps are left out: there can be dozens.
 */
export function timelineMarkers(messages: RaceMessage[], entries: Map<string, Entry>): TimelineMarker[] {
  const code = (id: string) => entries.get(id)?.code ?? id;
  const out: TimelineMarker[] = [];
  for (const m of messages) {
    const ids = m.carId ? [m.carId] : [];
    switch (m.kind) {
      case "start":
        out.push({ t: m.t, kind: "start", label: "Line", carIds: ids });
        break;
      case "fastest":
        out.push({ t: m.t, kind: "fastest", label: `${code(m.carId)} ${m.text}`, carIds: ids });
        break;
      case "deleted":
      case "strike":
        out.push({ t: m.t, kind: "warn", label: `${code(m.carId)} ${m.text}`, carIds: ids });
        break;
      case "crash":
      case "dnf":
        out.push({ t: m.t, kind: "dnf", label: `${code(m.carId)} out`, carIds: ids });
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
