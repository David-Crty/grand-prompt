import type { Entry } from "@bench/ui";
import { type CarIndex, type CarSample, sampleCar } from "./frames.js";
import type { LaunchBoard } from "./pack.js";
import type { StandingRow } from "./timing.js";

type Project = (x: number, y: number) => [number, number];

/**
 * Cars on the minimap: running and finished ones, drawn back to front so the leader sits on top of the cars
 * behind and the followed car on top of everything. Retired cars become pins instead.
 */
export function mapCars(
  model: { cars: CarIndex[]; entries: Map<string, Entry> },
  rows: StandingRow[],
  samples: CarSample[],
  focusId: string,
  project: Project,
) {
  const byId = new Map(model.cars.map((c, k) => [c.car.id, k]));
  const order = rows.filter((r) => !r.out).sort((a, b) => b.position - a.position);
  const focus = order.findIndex((r) => r.id === focusId);
  if (focus >= 0) order.push(...order.splice(focus, 1));
  return order.flatMap((r) => {
    const s = samples[byId.get(r.id) ?? -1];
    const entry = model.entries.get(r.id);
    if (!s || !entry) return [];
    const [x, y] = project(s.x, s.y);
    return [{ id: r.id, x, y, entry, focused: r.id === focusId }];
  });
}

/** A pin where each car that is out by time t stopped. */
export function mapPins(
  model: { cars: CarIndex[]; entries: Map<string, Entry> },
  t: number,
  project: Project,
) {
  return model.cars.flatMap((c) => {
    const at = c.outTime;
    if (at === null || at > t) return [];
    const s = sampleCar(c, at);
    const [x, y] = project(s.x, s.y);
    return [{ id: c.car.id, x, y, label: `${model.entries.get(c.car.id)?.code ?? c.car.name} out` }];
  });
}

/** Cars that retired within the last `window` seconds of replay time. */
export function justOut(cars: CarIndex[], t: number, window = 10): Set<string> {
  const out = new Set<string>();
  for (const c of cars) {
    const at = c.outTime;
    if (at !== null && at <= t && t - at < window) out.add(c.car.id);
  }
  return out;
}

/** The entries of these car ids, skipping unknown ones. */
export function entriesOf(ids: string[], entries: Map<string, Entry>): Entry[] {
  return ids.flatMap((id) => entries.get(id) ?? []);
}

/** The start board's rows and same-place groups, as entries. */
export function boardEntries(board: LaunchBoard, entries: Map<string, Entry>) {
  return {
    rows: board.rows.flatMap((r) => {
      const entry = entries.get(r.id);
      return entry ? [{ entry, distance: r.distance }] : [];
    }),
    same: board.same.map((g) => entriesOf(g, entries)),
  };
}

/** The focus card's lap clock: the running time from the line, then the lap time once it is timed. */
export function focusLap(
  c: CarIndex,
  row: StandingRow,
  t: number,
): { current: number | null; time: number | null } {
  const running = !row.finished && !row.out && t >= c.startTime;
  return {
    current: running ? t - c.startTime : null,
    time: row.finished && !row.deleted ? c.car.result.lapTime : null,
  };
}

/** P1 once its lap is timed: every car crosses the line together, so the first timed lap is the fastest. */
export function fastestId(rows: StandingRow[]): string | null {
  const p1 = rows[0];
  return p1?.finished && !p1.deleted ? p1.id : null;
}
