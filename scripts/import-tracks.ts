// Generates tracks/{monaco,silverstone,portimao}.json from the raw extracts in tracks/sources/.
// Run: pnpm tsx scripts/import-tracks.ts   (see tracks/sources/README.md for where the extracts come from)
import { readFileSync, writeFileSync } from "node:fs";
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

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

interface OsmMember {
  type: string;
  ref: number;
  role: string;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
}

interface OsmImport {
  file: string;
  /** Member ways that are not part of the racing line (pit lane, pit exit). */
  exclude: number[];
  /** Role of the node member marking the start/finish line. */
  startRole: string;
  clockwise: boolean;
  smooth: number;
  width: { left: number; right: number };
  meta: Omit<ImportedTrackMeta, "license" | "source">;
}

const ODBL = "ODbL-1.0, © OpenStreetMap contributors";

function fromOsm(o: OsmImport): TrackFile {
  const json = JSON.parse(read(o.file)) as { elements: { id: number; members: OsmMember[] }[] };
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
  return importedTrackFile(
    {
      ...o.meta,
      license: ODBL,
      source: `OpenStreetMap relation ${rel.id}, tracks/sources/${o.file.split("/").pop()}`,
    },
    points,
    o.width,
  );
}

const files: TrackFile[] = [
  fromOsm({
    file: "tracks/sources/osm-monaco.json",
    exclude: [850261588, 1388331347, 1551240829, 1551240830],
    startRole: "start-finish",
    clockwise: true,
    smooth: 3,
    width: { left: 4.5, right: 4.5 },
    meta: {
      id: "monaco",
      name: "Monaco",
      sectors: [0.33, 0.66],
      runoff: { default: { type: "grass", width: 3 } },
    },
  }),
  fromOsm({
    file: "tracks/sources/osm-portimao.json",
    exclude: [],
    startRole: "stop",
    clockwise: true,
    smooth: 4,
    width: { left: 7, right: 7 },
    meta: {
      id: "portimao",
      name: "Portimão",
      sectors: [0.33, 0.66],
      runoff: { default: { type: "grass", width: 18 } },
    },
  }),
  importedTrackFile(
    {
      id: "silverstone",
      name: "Silverstone",
      sectors: [0.33, 0.66],
      runoff: { default: { type: "grass", width: 18 } },
      license: "LGPL-3.0, TUMFTM racetrack-database (centerline from OpenStreetMap, ODbL)",
      source: "TUMFTM racetrack-database tracks/Silverstone.csv, tracks/sources/tumftm-silverstone.csv",
    },
    parseTumftmCsv(read("tracks/sources/tumftm-silverstone.csv")),
  ),
];

for (const file of files) {
  writeFileSync(new URL(`tracks/${file.id}.json`, root), `${JSON.stringify(file)}\n`);
  const t = Track.fromFile(file);
  let kMax = 0;
  for (const k of t.curvature) kMax = Math.max(kMax, Math.abs(k));
  console.log(
    `${file.id}: ${file.points.length} points, ${t.length.toFixed(0)} m, tightest radius ${(1 / kMax).toFixed(1)} m`,
  );
}
