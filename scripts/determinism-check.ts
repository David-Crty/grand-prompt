// CI determinism check: the same sandboxed race run in two separate processes must give identical hashes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const hashes: string[] = [];
for (let i = 0; i < 2; i++) {
  const out = mkdtempSync(join(tmpdir(), "det-"));
  execFileSync(
    "pnpm",
    [
      "-s",
      "bench",
      "race",
      "ddk/baseline-driver.js",
      "--reference",
      "--laps",
      "1",
      "--seed",
      "123",
      "--out",
      out,
    ],
    { stdio: "inherit" },
  );
  const replay = JSON.parse(gunzipSync(readFileSync(join(out, "replay.json.gz"))).toString());
  const raw = readFileSync(join(out, "replay.json.gz"));
  hashes.push(`${replay.header.stateHash}:${gunzipSync(raw).length}`);
}
console.log(`run 1: ${hashes[0]}\nrun 2: ${hashes[1]}`);
if (hashes[0] !== hashes[1]) {
  console.error("DETERMINISM FAILURE: hashes differ");
  process.exit(1);
}
console.log("deterministic: OK");
