import { type Replay, replayDuration } from "@bench/sim";
import type { Entry, TimelineMarker } from "@bench/ui";
import { type Corner, detectCorners } from "./corners.js";
import { eventEntries, recolorReplay } from "./entries.js";
import { type CarIndex, indexReplay } from "./frames.js";
import { analyseIncidents, type Incident } from "./incidents.js";
import { bestLapTraces, type LapTrace } from "./laps.js";
import { type RaceMessage, raceMessages } from "./messages.js";
import { timelineMarkers } from "./timeline.js";
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
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  messages: RaceMessage[];
  /** Corners numbered from the line, for "Turn 2" in messages and incident cards. */
  corners: Corner[];
  /** Every car ran alone and the runs are overlaid (the only mode until wheel-to-wheel racing exists). */
  ghost: boolean;
  markers: TimelineMarker[];
  /** Why each retired car went out, in time order. */
  incidents: Incident[];
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
  const corners = detectCorners(replay.track);
  const ghost = true;
  const messages = raceMessages(cars, corners, replay.header.launch ?? null);
  return {
    replay,
    entries,
    cars,
    layout,
    duration: replayDuration(replay),
    bounds: trackBounds(layout),
    messages,
    corners,
    ghost,
    markers: timelineMarkers(messages, entries),
    incidents: analyseIncidents(cars, replay.track, corners),
    traces: bestLapTraces(cars),
    grandstands,
    trees: placeTrees(layout, treeCount, replay.header.seed || 7, grandstands),
  };
}
