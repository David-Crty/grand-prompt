import { type Replay, replayDuration } from "@bench/sim";
import type { Entry, TimelineMarker } from "@bench/ui";
import { type Corner, detectCorners } from "./corners.js";
import { eventEntries } from "./entries.js";
import { type CarIndex, indexReplay } from "./frames.js";
import { analyseIncidents, type Incident } from "./incidents.js";
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
  replay: Replay;
  /** Code, colour and provider body paint per car id: the only source of a car's colour. */
  entries: Map<string, Entry>;
  cars: CarIndex[];
  layout: TrackLayout;
  duration: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  messages: RaceMessage[];
  /** Corners numbered from the line, for "Turn 2" in messages and incident cards. */
  corners: Corner[];
  markers: TimelineMarker[];
  /** Why each retired car went out, in time order. */
  incidents: Incident[];
  grandstands: Grandstand[];
  trees: Placement[];
}

export function buildModel(replay: Replay, treeCount = 1400): ViewerModel {
  const entries = eventEntries(replay.cars);
  const layout = buildLayout(replay.track);
  const cars = indexReplay(replay);
  const grandstands = placeGrandstands(layout, replay.track);
  const corners = detectCorners(replay.track);
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
    markers: timelineMarkers(messages, entries),
    incidents: analyseIncidents(cars, replay.track, corners),
    grandstands,
    trees: placeTrees(layout, treeCount, replay.header.seed || 7, grandstands),
  };
}
