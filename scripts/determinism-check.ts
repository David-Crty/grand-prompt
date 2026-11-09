// CI determinism check: the same sandboxed session run in two separate processes must give identical hashes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

// The submitted drivers exercise far more of the sandbox (Math.random, heavy init) than the baseline alone.
const drivers = readdirSync("drivers/gp-1").map((d) => join("drivers/gp-1", d, "driver.js"));
const hashes: string[] = [];
for (let i = 0; i < 2; i++) {
  const out = mkdtempSync(join(tmpdir(), "det-"));
  execFileSync(
    "pnpm",
    ["-s", "bench", "qualify", "ddk/baseline-driver.js", ...drivers, "--seed", "123", "--out", out],
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
