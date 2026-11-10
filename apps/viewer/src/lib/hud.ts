import type { Entry } from "@bench/ui";
import { type CarIndex, type CarSample, sampleCar } from "./frames.js";
import { liveStandings, type StandingRow } from "./timing.js";

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

/** P1 once its lap is timed: every car crosses the line together, so the first timed lap is the fastest. */
export function fastestId(rows: StandingRow[]): string | null {
  const p1 = rows[0];
  return p1?.finished && !p1.deleted ? p1.id : null;
}

/** Under the track name: why the cars drive through each other. */
export function ghostLine(cars: number): string {
  return cars === 1 ? "1 car, driving alone" : `${cars} cars, each driving alone`;
}

/** Cars that crossed the finish line in the played span (from, to]. */
export function crossedLine(cars: CarIndex[], from: number, to: number): string[] {
  return cars
    .filter((c) => c.finishTime !== null && c.finishTime > from && c.finishTime <= to)
    .map((c) => c.car.id);
}

/** The car followed when a replay opens: the winner (fastest valid lap), else the first car. */
export function defaultFocus(cars: CarIndex[], duration: number): string {
  const top = liveStandings(cars, duration)[0];
  return top?.finished && !top.deleted ? top.id : cars[0]!.car.id;
}

/** Cars that cross the finish line, in the order they cross it. */
export function finishers(cars: CarIndex[]): string[] {
  return cars
    .filter((c) => c.finishTime !== null)
    .sort((a, b) => a.finishTime! - b.finishTime!)
    .map((c) => c.car.id);
}

/** Replay seconds the camera stays on a car after it crosses the line. */
export const FINISH_HOLD = 2;

/**
 * Who to follow after playing (from, to]: once the followed car has been FINISH_HOLD s past the line, the car
 * that was following it when it crossed, unless that one has retired since.
 */
export function focusAfter(cars: CarIndex[], focusId: string, from: number, to: number): string {
  const fin = cars.find((c) => c.car.id === focusId)?.finishTime ?? null;
  if (fin === null || fin + FINISH_HOLD <= from || fin + FINISH_HOLD > to) return focusId;
  const out = new Set(cars.filter((c) => c.outTime !== null && c.outTime <= to).map((c) => c.car.id));
  return liveStandings(cars, fin).find((r) => !r.finished && !r.out && !out.has(r.id))?.id ?? focusId;
}
