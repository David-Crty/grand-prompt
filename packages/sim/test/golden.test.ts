// Golden hashes: any change to physics, race control or the track changes these on purpose.
// Regenerate with UPDATE_GOLDEN=1 pnpm vitest run packages/sim/test/golden.test.ts, and bump SIM_VERSION.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as baseline from "../../../ddk/baseline-driver.js";
import { createReferenceDriver } from "../../reference-driver/src/driver.js";
import { runSession, SIM_VERSION } from "../src/index.js";
import { protoCar, protoRing } from "./helpers.js";

const file = new URL("./golden.json", import.meta.url);

describe("golden replay hashes", () => {
  it("match the recorded values for this sim version", () => {
    const run = (runtime: typeof baseline) =>
      runSession(protoRing(), protoCar(), [{ id: "x", name: "x", runtime }], {
        type: "race",
        laps: 1,
        seed: 11,
      }).results.stateHash;
    const now = {
      simVersion: SIM_VERSION,
      trackHash: protoRing().hash,
      baseline: run(baseline),
      reference: run(createReferenceDriver()),
    };
    if (process.env.UPDATE_GOLDEN) writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    const golden = JSON.parse(readFileSync(file, "utf8"));
    expect(now).toEqual(golden);
  });
});
