// Debug render of a track (and optional replay paths) to SVG. Usage: tsx scripts/track-svg.ts <track.json> <out.svg>
import { readFileSync, writeFileSync } from "node:fs";
import { Track, type TrackFile } from "@bench/sim";

const [file, out] = process.argv.slice(2);
if (!file || !out) throw new Error("usage: track-svg <track.json> <out.svg>");
const t = Track.fromFile(JSON.parse(readFileSync(file, "utf8")) as TrackFile);
const edge = (side: number, extra: (i: number) => number) => {
  const pts: string[] = [];
  for (let i = 0; i < t.count; i++) {
    const w = side > 0 ? t.widthLeft[i]! : t.widthRight[i]!;
    const p = t.toWorld(i * t.spacing, side * (w + extra(i)));
    pts.push(`${p.x.toFixed(1)},${(-p.y).toFixed(1)}`);
  }
  return pts.join(" ");
};
let minX = Infinity,
  maxX = -Infinity,
  minY = Infinity,
  maxY = -Infinity;
for (let i = 0; i < t.count; i++) {
  minX = Math.min(minX, t.x[i]!);
  maxX = Math.max(maxX, t.x[i]!);
  minY = Math.min(minY, -t.y[i]!);
  maxY = Math.max(maxY, -t.y[i]!);
}
const pad = 60;
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}" width="1600">`,
  `<rect x="${minX - pad}" y="${minY - pad}" width="${maxX - minX + 2 * pad}" height="${maxY - minY + 2 * pad}" fill="#8fbf6a"/>`,
  `<polygon points="${edge(1, (i) => t.runoffWidthLeft[i]!)}" fill="none" stroke="#555" stroke-width="2"/>`,
  `<polygon points="${edge(-1, (i) => t.runoffWidthRight[i]!)}" fill="none" stroke="#555" stroke-width="2"/>`,
  `<polygon points="${edge(1, () => 0)}" fill="none" stroke="#fff" stroke-width="2"/>`,
  `<polygon points="${edge(-1, () => 0)}" fill="none" stroke="#fff" stroke-width="2"/>`,
];
for (let i = 0; i < t.count; i++) {
  for (const side of [1, -1]) {
    const k = side > 0 ? t.kerbLeft[i] : t.kerbRight[i];
    if (!k) continue;
    const w = side > 0 ? t.widthLeft[i]! : t.widthRight[i]!;
    const p = t.toWorld(i * t.spacing, side * (w + 0.6));
    parts.push(
      `<circle cx="${p.x.toFixed(1)}" cy="${(-p.y).toFixed(1)}" r="1.2" fill="${i % 2 ? "#d00" : "#fff"}"/>`,
    );
  }
  const g = t.runoffTypeRight[i] === 1 || t.runoffTypeLeft[i] === 1;
  if (g && i % 3 === 0) {
    const side = t.runoffTypeLeft[i] === 1 ? 1 : -1;
    const w = side > 0 ? t.widthLeft[i]! : t.widthRight[i]!;
    const p = t.toWorld(i * t.spacing, side * (w + 8));
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${(-p.y).toFixed(1)}" r="3" fill="#d8c48a"/>`);
  }
}
for (const [s, c] of [
  [0, "#000"],
  [t.sectors[0], "#ff0"],
  [t.sectors[1], "#0ff"],
] as const) {
  const a = t.toWorld(s, 10),
    b = t.toWorld(s, -10);
  parts.push(`<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}" stroke="${c}" stroke-width="4"/>`);
}
parts.push("</svg>");
writeFileSync(out, parts.join("\n"));
