// CI determinism check: the same sandboxed session run in two separate processes must give identical hashes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

// The submitted drivers exercise far more of the sandbox (Math.random, heavy init) than the baseline alone.
const hashes: string[] = [];
for (let i = 0; i < 2; i++) {
  const out = mkdtempSync(join(tmpdir(), "det-"));
  execFileSync("pnpm", ["-s", "bench", "race", "r1-medium", "--track", "proto-ring", "--out", out], {
    stdio: "inherit",
  });
  const raw = readFileSync(join(out, "r1-medium-proto-ring", "replay.json.gz"));
  const replay = JSON.parse(gunzipSync(raw).toString());
  hashes.push(`${replay.header.stateHash}:${gunzipSync(raw).length}`);
}
console.log(`run 1: ${hashes[0]}\nrun 2: ${hashes[1]}`);
if (hashes[0] !== hashes[1]) {
  console.error("DETERMINISM FAILURE: hashes differ");
  process.exit(1);
}
console.log("deterministic: OK");
