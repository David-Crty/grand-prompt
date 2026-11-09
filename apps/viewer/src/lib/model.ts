import { type Replay, replayDuration } from "@bench/sim";
import { type CarIndex, indexReplay } from "./frames.js";
import { bestLapTraces, type LapTrace } from "./laps.js";
import { type RaceMessage, raceMessages } from "./messages.js";
import {
  buildLayout,
  type Grandstand,
  type Placement,
  placeGrandstands,
  placeTrackside,
  placeTrees,
  type TrackLayout,
  type TracksideCam,
  trackBounds,
} from "./track.js";

/** Everything the viewer derives from a replay once, before rendering. */
export interface ViewerModel {
  replay: Replay;
  cars: CarIndex[];
  layout: TrackLayout;
  duration: number;
  totalLaps: number;
  cams: TracksideCam[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  messages: RaceMessage[];
  traces: LapTrace[];
  grandstands: Grandstand[];
  trees: Placement[];
}

export function buildModel(replay: Replay, treeCount = 1400): ViewerModel {
  const layout = buildLayout(replay.track);
  const cars = indexReplay(replay);
  const grandstands = placeGrandstands(layout, replay.track);
  return {
    replay,
    cars,
    layout,
    duration: replayDuration(replay),
    totalLaps: replay.header.session.laps,
    cams: placeTrackside(layout),
    bounds: trackBounds(layout),
    messages: raceMessages(cars),
    traces: bestLapTraces(cars),
    grandstands,
    trees: placeTrees(layout, treeCount, replay.header.seed || 7, grandstands),
  };
}
