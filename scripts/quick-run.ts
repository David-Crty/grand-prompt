// Dev helper: run a driver module unsandboxed. tsx scripts/quick-run.ts <driver> [laps] [type]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type CarConfig, runSession, summarizeSession, Track, type TrackFile } from "@bench/sim";

const [driverPath = "ddk/baseline-driver.js", laps = "3", type = "practice"] = process.argv.slice(2);
const track = Track.fromFile(JSON.parse(readFileSync("tracks/proto-ring.json", "utf8")) as TrackFile);
const car = JSON.parse(readFileSync("cars/proto.json", "utf8")) as CarConfig;
const mod = await import(pathToFileURL(resolve(driverPath)).href);
const t0 = performance.now();
const out = runSession(track, car, [{ id: "d", name: driverPath, runtime: mod }], {
  type: type as "practice",
  laps: Number(laps),
  seed: 1,
  infoLevel: "A",
});
console.log(summarizeSession(out.results, out.runs));
console.log(`wall ${(performance.now() - t0).toFixed(0)} ms, hash ${out.results.stateHash}`);
