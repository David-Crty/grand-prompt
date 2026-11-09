import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chainWays,
  type ImportedTrackMeta,
  importedTrackFile,
  parseTumftmCsv,
  prepareCenterline,
  projectLonLat,
  Track,
  type TrackFile,
  type Vec2,
} from "@bench/sim";
import { loadTrack, repoRoot } from "./load.js";
import type { CommandOutput } from "./session.js";

/** The circuits in `tracks/`, with their names and lengths. */
export function listTracks(): CommandOutput {
  const ids = readdirSync(join(repoRoot(), "tracks"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
  const lines = ids.map((id) => {
    const t = loadTrack(id);
    return `${id.padEnd(14)} ${t.name.padEnd(18)} ${(t.length / 1000).toFixed(3)} km`;
  });
  return { text: `${lines.join("\n")}\n` };
}

interface OsmMember {
  type: string;
  ref: number;
  role: string;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
}

/** An OpenStreetMap circuit relation, exported with its member geometry (see tracks/sources/README.md). */
interface OsmSource {
  kind: "osm";
  file: string;
  /** Member ways that are not part of the racing line (pit lane, pit exit, stubs). */
  exclude: number[];
  /** Role of the node member marking the start/finish line. */
  startRole: string;
  clockwise: boolean;
  /** Gaussian smoothing radius, metres. */
  smooth: number;
  /** OSM has no reliable widths, so the circuit gets a constant one. */
  width: { left: number; right: number };
}

/** A TUMFTM racetrack-database centreline with measured widths. */
interface TumftmSource {
  kind: "tumftm";
  file: string;
  license: string;
  source: string;
}

type TrackSource = (OsmSource | TumftmSource) & { meta: Omit<ImportedTrackMeta, "license" | "source"> };

const thirds: [number, number] = [0.33, 0.66];
const grass18 = { default: { type: "grass" as const, width: 18 } };
const TUMFTM_LICENSE = "LGPL-3.0, TUMFTM racetrack-database (centerline from OpenStreetMap, ODbL)";

/** Every imported circuit. Add one here, with its raw extract in `tracks/sources/`, then `bench tracks import`. */
export const TRACK_SOURCES: TrackSource[] = [
  {
    kind: "osm",
    file: "osm-monaco.json",
    exclude: [850261588, 1388331347, 1551240829, 1551240830],
    startRole: "start-finish",
    clockwise: true,
    smooth: 3,
    width: { left: 4.5, right: 4.5 },
    meta: { id: "monaco", name: "Monaco", sectors: thirds, runoff: { default: { type: "grass", width: 3 } } },
  },
  {
    kind: "osm",
    file: "osm-portimao.json",
    exclude: [],
    startRole: "stop",
    clockwise: true,
    smooth: 4,
    width: { left: 7, right: 7 },
    meta: { id: "portimao", name: "Portimão", sectors: thirds, runoff: grass18 },
  },
  {
    kind: "tumftm",
    file: "tumftm-silverstone.csv",
    license: TUMFTM_LICENSE,
    source: "TUMFTM racetrack-database tracks/Silverstone.csv",
    meta: { id: "silverstone", name: "Silverstone", sectors: thirds, runoff: grass18 },
  },
  {
    kind: "tumftm",
    file: "tumftm-barcelona.csv",
    license: TUMFTM_LICENSE,
    source: "TUMFTM racetrack-database tracks/Catalunya.csv",
    meta: { id: "barcelona", name: "Barcelona", sectors: thirds, runoff: grass18 },
  },
];

function fromOsm(o: OsmSource & { meta: TrackSource["meta"] }, text: string): TrackFile {
  const json = JSON.parse(text) as { elements: { id: number; members: OsmMember[] }[] };
  const rel = json.elements[0]!;
  const startNode = rel.members.find((m) => m.type === "node" && m.role === o.startRole)!;
  const origin: Vec2 = [startNode.lon!, startNode.lat!];
  const ways = rel.members
    .filter((m) => m.type === "way" && m.role !== "pit_lane" && !o.exclude.includes(m.ref))
    .map((m) =>
      projectLonLat(
        m.geometry!.map((g): Vec2 => [g.lon, g.lat]),
        origin,
      ),
    );
  const ring = chainWays(ways, 40);
  const points = prepareCenterline(ring, { start: [0, 0], clockwise: o.clockwise, smooth: o.smooth });
  const meta = {
    ...o.meta,
    license: "ODbL-1.0, © OpenStreetMap contributors",
    source: `OpenStreetMap relation ${rel.id}, tracks/sources/${o.file}`,
  };
  return importedTrackFile(meta, points, o.width);
}

export function importTrack(src: TrackSource, text: string): TrackFile {
  if (src.kind === "osm") return fromOsm(src, text);
  const meta = { ...src.meta, license: src.license, source: `${src.source}, tracks/sources/${src.file}` };
  return importedTrackFile(meta, parseTumftmCsv(text));
}

/** Rebuild `tracks/<id>.json` for every source in TRACK_SOURCES from the raw extracts in `tracks/sources/`. */
export function importTracks(): CommandOutput {
  const dir = join(repoRoot(), "tracks");
  const lines = TRACK_SOURCES.map((src) => {
    const file = importTrack(src, readFileSync(join(dir, "sources", src.file), "utf8"));
    writeFileSync(join(dir, `${file.id}.json`), `${JSON.stringify(file)}\n`);
    const t = Track.fromFile(file);
    const kMax = t.curvature.reduce((m, k) => Math.max(m, Math.abs(k)), 0);
    return `${file.id}: ${file.points.length} points, ${t.length.toFixed(0)} m, tightest radius ${(1 / kMax).toFixed(1)} m`;
  });
  return { text: `${lines.join("\n")}\n` };
}
