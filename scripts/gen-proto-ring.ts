// Generates tracks/proto-ring.json from a segment description. Run: pnpm tsx scripts/gen-proto-ring.ts
import { writeFileSync } from "node:fs";
import { buildTrack, type RunoffZone, type Segment, Track, trackFileFromBuilt } from "@bench/sim";

const segs: Segment[] = [
  { kind: "straight", length: 900, adjust: "a", width: 15, label: "Main straight" },
  { kind: "corner", angle: 180, radius: 16, transition: 14, label: "T1 hairpin" },
  { kind: "straight", length: 140 },
  { kind: "corner", angle: -90, radius: 45, label: "T2" },
  { kind: "straight", length: 220 },
  { kind: "corner", angle: 45, radius: 32, transition: 12, label: "T3-T4 chicane" },
  { kind: "straight", length: 12 },
  { kind: "corner", angle: -45, radius: 32, transition: 12 },
  { kind: "straight", length: 260, adjust: "b", label: "Back straight" },
  { kind: "corner", angle: 100, radius: 230, transition: 40, label: "T5 sweeper" },
  { kind: "straight", length: 150 },
  { kind: "corner", angle: -40, radius: 70, label: "T6-T8 esses" },
  { kind: "corner", angle: 80, radius: 70 },
  { kind: "corner", angle: -40, radius: 70 },
  { kind: "straight", length: 220 },
  { kind: "corner", angle: 35, radius: 75, label: "T9 double apex" },
  { kind: "corner", angle: 10, radius: 220 },
  { kind: "corner", angle: 35, radius: 75 },
  { kind: "straight", length: 480 },
  { kind: "corner", angle: 90, radius: 135, transition: 40, label: "T10 fast final corner" },
  { kind: "straight", length: 150, width: 15 },
];

const built = buildTrack(segs, { defaultWidth: 13, step: 4 });
const at = (label: string) => built.labels.find((l) => l.label === label)!.s / built.length;
const L = built.length;
const m = (v: number) => v / L;
const gravel = (label: string, before: number, after: number, side: RunoffZone["side"]): RunoffZone => ({
  type: "gravel",
  width: 25,
  side,
  from: at(label) - m(before),
  to: at(label) + m(after),
});

const file = trackFileFromBuilt(built, {
  id: "proto-ring",
  name: "Prototype Ring",
  version: 1,
  sectors: [at("T3-T4 chicane") + m(120), at("T9 double apex")],
  runoff: {
    default: { type: "grass", width: 15 },
    zones: [
      gravel("T1 hairpin", 120, 60, "right"),
      gravel("T3-T4 chicane", 40, 80, "both"),
      gravel("T6-T8 esses", 20, 220, "both"),
      gravel("T10 fast final corner", 0, 240, "right"),
    ],
  },
});
writeFileSync(new URL("../tracks/proto-ring.json", import.meta.url), `${JSON.stringify(file)}\n`);
const track = Track.fromFile(file);
console.log(
  `proto-ring: ${built.points.length} points, builder length ${L.toFixed(1)} m, spline length ${track.length.toFixed(1)} m, closure error ${built.closureError.toExponential(2)}`,
);
for (const l of built.labels) console.log(`  ${l.label.padEnd(24)} s=${l.s.toFixed(0)}`);
