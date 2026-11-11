// `bench select`: one driver per model from repeated builds, chosen on the practice circuits only.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Manifest, rankCandidates, run, SELECTION_RULE, scoreCandidate } from "../src/index.js";

const repo = new URL("../../../", import.meta.url).pathname;
const baseline = readFileSync(join(repo, "driver-development-kit/baseline-driver.js"), "utf8");
const slower = baseline.replace("const LATERAL_ACCEL = 12;", "const LATERAL_ACCEL = 10;");
const straight =
  "export function init() {}\nexport function step() { return { throttle: 1, brake: 0, steer: 0 }; }\n";
let root: string;
let prevRoot: string | undefined;

function put(rel: string, content: string) {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
}
function entry(event: string, slug: string, source: string, settings: Record<string, unknown> = {}) {
  put(`drivers/${event}/${slug}/driver.js`, source);
  put(
    `drivers/${event}/${slug}/manifest.json`,
    JSON.stringify({ model: slug.toUpperCase(), settings: { practiceTracks: ["proto-ring"], ...settings } }),
  );
}
function event(id: string, seed = 7) {
  put(`drivers/${id}/event.json`, JSON.stringify({ name: id, seed }));
}
async function cli(...args: string[]): Promise<string> {
  let out = "";
  await run(args, (s) => {
    out += s;
  });
  return out;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "bench-select-"));
  for (const d of ["tracks", "cars", "driver-development-kit"])
    cpSync(join(repo, d), join(root, d), { recursive: true });
  prevRoot = process.env.BENCH_ROOT;
  process.env.BENCH_ROOT = root;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env.BENCH_ROOT;
  else process.env.BENCH_ROOT = prevRoot;
});

describe("ranking", () => {
  it("puts valid laps first, then total time, then the earlier event", () => {
    const a = scoreCandidate("a", { x: 80, y: null });
    const b = scoreCandidate("b", { x: 90, y: 100 });
    const c = scoreCandidate("c", { x: 85, y: 100 });
    const d = scoreCandidate("d", { x: 85, y: 100 });
    expect(b).toEqual({ event: "b", laps: { x: 90, y: 100 }, validLaps: 2, totalTime: 190 });
    expect(scoreCandidate("e", { x: null })).toMatchObject({ validLaps: 0, totalTime: 0 });
    expect(rankCandidates([a, b, c, d]).map((x) => x.event)).toEqual(["c", "d", "b", "a"]);
  });
});

describe("bench select", () => {
  it("picks each model's best build on its practice circuits and copies it as is", async () => {
    event("s1");
    event("s2");
    entry("s1", "pace", slower);
    entry("s2", "pace", baseline);
    entry("s1", "risk", straight);
    entry("s2", "risk", slower);
    entry("s1", "tie", baseline);
    entry("s2", "tie", baseline);
    entry("s1", "once", slower);
    const out = await cli("select", "--output", "best", "--input", "s1,s2");
    expect(out).toMatch(/select best from s1, s2/);
    expect(out).toMatch(/\| PACE +\| s2 +\| 1\/1 /);
    expect(out).toMatch(/\| RISK +\| s2 +\| 0\/1 - /);
    expect(out).toMatch(/\| ONCE +\| s1 +\| 1\/1 .*\| - +\|/);
    expect(JSON.parse(readFileSync(join(root, "drivers/best/event.json"), "utf8"))).toEqual({
      name: "best",
      seed: 7,
    });
    const chosen = (slug: string) =>
      JSON.parse(readFileSync(join(root, `drivers/best/${slug}/manifest.json`), "utf8")) as Manifest;
    expect(chosen("pace").selection!.event).toBe("s2");
    expect(chosen("risk").selection!.event).toBe("s2");
    expect(chosen("tie").selection!.event).toBe("s1");
    expect(chosen("once").selection!.event).toBe("s1");
    expect(chosen("pace")).toMatchObject({ model: "PACE", settings: { practiceTracks: ["proto-ring"] } });
    const risk = chosen("risk").selection!;
    expect(risk.rule).toBe(SELECTION_RULE);
    expect(risk.candidates.map((c) => [c.event, c.validLaps])).toEqual([
      ["s1", 0],
      ["s2", 1],
    ]);
    expect(risk.candidates[0]!.laps).toEqual({ "proto-ring": null });
    expect(readFileSync(join(root, "drivers/best/pace/driver.js"), "utf8")).toBe(baseline);
    await expect(cli("select", "--output", "best", "--input", "s1,s2")).rejects.toThrow(
      /drivers\/best\/ already exists/,
    );
  });

  it("refuses sources it cannot compare", async () => {
    await expect(cli("select", "--input", "s1,s2")).rejects.toThrow(/--output <event> is required/);
    await expect(cli("select", "--output", "x")).rejects.toThrow(/--input <event,event,...> is required/);
    await expect(cli("select", "--output", "x", "--input", "s1")).rejects.toThrow(
      /--input needs at least two/,
    );
    await expect(cli("select", "--output", "x", "--input", "s1,s1")).rejects.toThrow(/listed twice/);
    await expect(cli("select", "--output", "s1", "--input", "s1,s2")).rejects.toThrow(
      /both --output and --input/,
    );
    await expect(cli("select", "--output", "x", "--input", "s1,nope")).rejects.toThrow(/no event 'nope'/);
    event("seeded", 8);
    await expect(cli("select", "--output", "x", "--input", "s1,seeded")).rejects.toThrow(
      /different seeds \(7, 8\)/,
    );
    event("bare");
    put("drivers/bare/m/driver.js", baseline);
    await expect(cli("select", "--output", "x", "--input", "s1,bare")).rejects.toThrow(
      /bare\/m has no manifest/,
    );
    event("untracked");
    put("drivers/untracked/m/driver.js", baseline);
    put("drivers/untracked/m/manifest.json", JSON.stringify({ model: "M" }));
    await expect(cli("select", "--output", "x", "--input", "s1,untracked")).rejects.toThrow(
      /records no practice circuits/,
    );
    event("elsewhere");
    entry("elsewhere", "pace", baseline, { practiceTracks: ["monaco"] });
    await expect(cli("select", "--output", "x", "--input", "s1,elsewhere")).rejects.toThrow(
      /pace practised on proto-ring in one event, monaco in another/,
    );
    expect(existsSync(join(root, "drivers/x"))).toBe(false);
    rmSync(join(root, "drivers/best"), { recursive: true });
  });
});
