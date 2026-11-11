// driver-development-kit/driver.d.ts is hand-written for LLM readers; keep it in sync with what the sim sends.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_VERSION, CarSim, carSpec, DRIVER_DEVELOPMENT_KIT_VERSION } from "../src/index.js";
import { fnDriver, protoCar, protoRing } from "./helpers.js";

const dts = readFileSync(new URL("../../../driver-development-kit/driver.d.ts", import.meta.url), "utf8");
function fields(name: string): string[] {
  const m = dts.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`interface ${name} not found in driver.d.ts`);
  return [...m[1]!.matchAll(/^\s+(\w+)\??:/gm)].map((x) => x[1]!).sort();
}

describe("driver-development-kit/driver.d.ts matches the sim", () => {
  const sim = new CarSim(
    protoRing(),
    protoCar(),
    { id: "x", name: "x", runtime: fnDriver(() => null) },
    { seed: 1 },
  );
  it("Telemetry", () => expect(fields("Telemetry")).toEqual(Object.keys(sim.telemetryNow()).sort()));
  it("TrackInfo and TrackSample", () => {
    const info = protoRing().toInfo();
    expect(fields("TrackInfo")).toEqual(Object.keys(info).sort());
    expect(fields("TrackSample")).toEqual(Object.keys(info.samples[0]!).sort());
  });
  it("CarSpec", () =>
    expect(fields("CarSpec")).toEqual([...Object.keys(carSpec(protoCar())), "hidden"].sort()));
  it("Controls", () => expect(fields("Controls")).toEqual(["brake", "steer", "throttle"]));
  it("DRIVER_SPEC.md states the kit and API versions", () => {
    const spec = readFileSync(
      new URL("../../../driver-development-kit/DRIVER_SPEC.md", import.meta.url),
      "utf8",
    );
    expect(spec.split("\n")[0]).toBe(
      `# Driver Specification (driver development kit ${DRIVER_DEVELOPMENT_KIT_VERSION}, API ${API_VERSION})`,
    );
  });
  it("car-public.json is the public section", () => {
    const pub = JSON.parse(
      readFileSync(new URL("../../../driver-development-kit/car-public.json", import.meta.url), "utf8"),
    );
    expect(pub).toMatchObject(protoCar().public);
    expect(JSON.stringify(pub)).not.toMatch(/ClA|CdA|tire/);
  });
});
