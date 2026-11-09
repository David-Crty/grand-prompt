import { type Replay, replayDuration } from "@bench/sim";
import type { Entry } from "@bench/ui";
import { eventEntries, recolorReplay } from "./entries.js";
import { type CarIndex, indexReplay } from "./frames.js";
import { bestLapTraces, type LapTrace } from "./laps.js";
import { type RaceMessage, raceMessages } from "./messages.js";
import {
  buildLayout,
  type Grandstand,
  type Placement,
  placeGrandstands,
  placeTrees,
  type TrackLayout,
  trackBounds,
} from "./track.js";

/** Everything the viewer derives from a replay once, before rendering. */
export interface ViewerModel {
  /** The replay with entry colours applied (see lib/entries.ts). */
  replay: Replay;
  /** Code, slot, colour and provider body paint per car id. */
  entries: Map<string, Entry>;
  cars: CarIndex[];
  layout: TrackLayout;
  duration: number;
  totalLaps: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  messages: RaceMessage[];
  traces: LapTrace[];
  grandstands: Grandstand[];
  trees: Placement[];
}

export function buildModel(source: Replay, treeCount = 1400): ViewerModel {
  const entries = eventEntries(source.cars);
  const replay = recolorReplay(source, entries);
  const layout = buildLayout(replay.track);
  const cars = indexReplay(replay);
  const grandstands = placeGrandstands(layout, replay.track);
  return {
    replay,
    entries,
    cars,
    layout,
    duration: replayDuration(replay),
    totalLaps: replay.header.session.laps,
    bounds: trackBounds(layout),
    messages: raceMessages(cars),
    traces: bestLapTraces(cars),
    grandstands,
    trees: placeTrees(layout, treeCount, replay.header.seed || 7, grandstands),
  };
}
