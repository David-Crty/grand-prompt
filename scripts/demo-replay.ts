// Writes results/demo/replay.json(.gz): 4 ghost cars (reference at several paces + baseline).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createReferenceDriver } from "@bench/reference-driver";
import { type CarConfig, runSession, summarizeSession, Track, type TrackFile } from "@bench/sim";
import * as baseline from "../ddk/baseline-driver.js";

const laps = Number(process.argv[2] ?? 3);
const track = Track.fromFile(JSON.parse(readFileSync("tracks/proto-ring.json", "utf8")) as TrackFile);
const car = JSON.parse(readFileSync("cars/proto.json", "utf8")) as CarConfig;
const out = runSession(
  track,
  car,
  [
    { id: "ref-100", name: "Reference 100%", runtime: createReferenceDriver() },
    { id: "ref-97", name: "Reference 97%", runtime: createReferenceDriver({ pace: 0.97 }) },
    { id: "ref-92", name: "Reference 92%", runtime: createReferenceDriver({ pace: 0.92 }) },
    { id: "baseline", name: "DDK baseline", runtime: baseline },
  ],
  { type: "race", laps, seed: 42, infoLevel: "A" },
);
const ref = out.results.classification.find((c) => c.id === "ref-100");
if (ref?.bestLap) out.replay.header.referenceLap = ref.bestLap;
mkdirSync("results/demo", { recursive: true });
const json = JSON.stringify(out.replay);
writeFileSync("results/demo/replay.json", json);
writeFileSync("results/demo/replay.json.gz", gzipSync(json));
console.log(summarizeSession(out.results, out.runs));
console.log(`replay ${(json.length / 1e6).toFixed(2)} MB, gz ${(gzipSync(json).length / 1e6).toFixed(2)} MB`);
