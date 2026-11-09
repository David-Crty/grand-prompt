// Feature tests for the bench CLI: real sandboxed sessions, events, the practice service.
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWorkspace,
  driverIdentity,
  type EventResults,
  leaderboard,
  readReplay,
  readTokens,
  registerToken,
  replayInfo,
  run,
  serve,
  USAGE,
} from "../src/index.js";

const exec = promisify(execFile);
const repo = new URL("../../../", import.meta.url).pathname;
let root: string;
let prevRoot: string | undefined;

const baselineSrc = readFileSync(join(repo, "ddk/baseline-driver.js"), "utf8");
const slower = baselineSrc.replace("const LATERAL_ACCEL = 12;", "const LATERAL_ACCEL = 10;");

async function cli(...args: string[]): Promise<{ code: number; out: string }> {
  let out = "";
  const code = await run(args, (s) => {
    out += s;
  });
  return { code, out };
}

function file(rel: string, content: string): string {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
  return p;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "bench-root-"));
  for (const d of ["tracks", "cars", "ddk"]) cpSync(join(repo, d), join(root, d), { recursive: true });
  cpSync(join(repo, "packages/reference-driver/src"), join(root, "packages/reference-driver/src"), {
    recursive: true,
  });
  prevRoot = process.env.BENCH_ROOT;
  process.env.BENCH_ROOT = root;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env.BENCH_ROOT;
  else process.env.BENCH_ROOT = prevRoot;
});

describe("argument handling", () => {
  it("prints usage", async () => {
    expect((await cli("--help")).out).toBe(USAGE);
    expect((await cli()).code).toBe(1);
  });
  it("rejects bad input", async () => {
    await expect(cli("frobnicate")).rejects.toThrow(/unknown command/);
    await expect(cli("practice")).rejects.toThrow(/missing <driver>/);
    await expect(cli("validate", "x.js", "--info", "C")).rejects.toThrow(/--info/);
    await expect(cli("event", "explode", "x")).rejects.toThrow(/unknown event subcommand/);
    await expect(cli("workspace", "/tmp/nope")).rejects.toThrow(/--model/);
    await expect(cli("practice", "missing.js")).rejects.toThrow(/driver not found/);
    await expect(
      cli("practice", join(root, "ddk/baseline-driver.js"), "--track", "atlantis"),
    ).rejects.toThrow(/unknown track/);
  });
});

describe("validate", () => {
  it("passes the baseline", async () => {
    const r = await cli("validate", join(root, "ddk/baseline-driver.js"));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/ok {3}load/);
    expect(r.out).toMatch(/ok {3}init/);
    expect(r.out).toMatch(/PASS/);
  });
  it("reports load, init and step failures", async () => {
    const syntax = await cli("validate", file("bad/syntax.js", "export function step( {"));
    expect(syntax.code).toBe(2);
    expect(syntax.out).toMatch(/FAIL load: Expected identifier .*syntax\.js:1/);
    const init = await cli(
      "validate",
      file("bad/init.js", "export function init() { throw new Error('x') } export function step() {}"),
    );
    expect(init.out).toMatch(/FAIL init: init failed: Error: x/);
    const step = await cli(
      "validate",
      file(
        "bad/step.js",
        "export function step(t) { log('hi', t.t); if (t.t > 1) throw new Error('late'); return {throttle:0.3,brake:0,steer:0}; }",
      ),
    );
    expect(step.code).toBe(2);
    expect(step.out).toMatch(/WARN step/);
    expect(step.out).toMatch(/error: .*late/);
    expect(step.out).toMatch(/log \(first 10 lines\)/);
    expect(step.out).toMatch(/FAIL$/m);
  });
});

describe("practice", () => {
  it("writes telemetry, summaries, logs and a replay", async () => {
    const out = join(root, "results/p");
    const r = await cli("practice", join(root, "ddk/baseline-driver.js"), "--laps", "1", "--out", out);
    expect(r.out).toMatch(/PRACTICE on proto-ring/);
    expect(r.out).toMatch(/budget: init \d+ units/);
    for (const f of [
      "telemetry.csv",
      "summary.json",
      "summary.txt",
      "log.txt",
      "results.json",
      "replay.json.gz",
    ])
      expect(existsSync(join(out, f))).toBe(true);
    const s = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
    expect(s.result.status).toBe("FINISHED");
    expect(s.budgetUsage.steps).toBeGreaterThan(1000);
    expect(readFileSync(join(out, "telemetry.csv"), "utf8").split("\n")[0]).toMatch(/^t,lap,s,speed/);
    // default output directory numbering
    const auto = await cli("practice", join(root, "ddk/baseline-driver.js"), "--laps", "1");
    expect(auto.out).toMatch(/baseline-driver-001/);
  });
});

describe("qualify and race", () => {
  it("runs a race with the reference and writes a replay", async () => {
    const out = join(root, "results/race1");
    const a = file("drivers/adhoc/alpha/driver.js", slower);
    file("drivers/adhoc/alpha/manifest.json", JSON.stringify({ model: "alpha-model" }));
    const r = await cli(
      "race",
      a,
      join(root, "ddk/baseline-driver.js"),
      "--laps",
      "1",
      "--reference",
      "--out",
      out,
      "--seed",
      "9",
    );
    expect(r.out).toMatch(/RACE on proto-ring/);
    expect(r.out).toMatch(/P1 Reference \(house\)/);
    expect(r.out).toMatch(/gap to reference/);
    expect(r.out).toMatch(/alpha-model: \+\d/);
    const replay = readReplay(join(out, "replay.json.gz"));
    expect(replay.cars).toHaveLength(3);
    expect(replay.header.referenceLap).toBeGreaterThan(60);
    expect(replay.header.seed).toBe(9);
    expect(replayInfo(join(out, "replay.json.gz")).text).toMatch(/race on proto-ring, 3 cars/);
    writeFileSync(join(out, "plain.json"), JSON.stringify(replay));
    expect(readReplay(join(out, "plain.json")).header.stateHash).toBe(replay.header.stateHash);
    expect((await cli("replay", join(out, "replay.json.gz"))).out).toMatch(/hash/);
  });
  it("lists the circuits and races on one picked by id", async () => {
    const list = (await cli("tracks")).out;
    for (const id of ["monaco", "portimao", "proto-ring", "silverstone"])
      expect(list).toMatch(new RegExp(`^${id} `, "m"));
    expect(list).toMatch(/Monaco\s+3\.\d{3} km/);
    const out = join(root, "results/monaco");
    const r = await cli(
      "race",
      join(root, "ddk/baseline-driver.js"),
      "--track",
      "monaco",
      "--laps",
      "1",
      "--out",
      out,
    );
    expect(r.out).toMatch(/RACE on monaco/);
    expect(r.out).toMatch(/\[FINISHED\]/);
    expect(readReplay(join(out, "replay.json.gz")).header.trackId).toBe("monaco");
  });
  it("qualifies two copies of the same driver under distinct ids", async () => {
    const r = await cli(
      "qualify",
      join(root, "ddk/baseline-driver.js"),
      join(root, "ddk/baseline-driver.js"),
      "--out",
      join(root, "results/q1"),
    );
    expect(r.out).toMatch(/QUALIFY/);
    expect(r.out).toMatch(/baseline-driver #2/);
    const auto = await cli("race", join(root, "ddk/baseline-driver.js"), "--laps", "1");
    expect(auto.out).toMatch(/proto-ring-001/);
  });
});

describe("events: run, reproduce, leaderboard", () => {
  it("runs an event end to end and reproduces it from the stored hashes", async () => {
    const ev = "ev-test";
    file(
      `results/${ev}/event.json`,
      JSON.stringify({
        id: ev,
        name: "Test GP",
        track: "proto-ring",
        qualifyAttempts: 1,
        raceLaps: 1,
        seed: 4,
        infoLevel: "B",
      }),
    );
    file(`drivers/${ev}/model-a/driver.js`, baselineSrc);
    file(`drivers/${ev}/model-b/driver.js`, slower);
    file(`drivers/${ev}/model-c/driver.js`, "export function step( {");
    file(`drivers/${ev}/not-a-driver/readme.txt`, "x");
    file(
      `results/${ev}/model-a/manifest.json`,
      JSON.stringify({
        model: "Model A",
        mode: "one-shot",
        usage: { inputTokens: 30000, outputTokens: 12000, costUsd: 0.42 },
      }),
    );
    const r = await cli("event", "run", ev);
    expect(r.out).toMatch(/Test GP \(ev-test\)/);
    expect(r.out).toMatch(/Model A/);
    expect(r.out).toMatch(/\$0\.42/);
    expect(r.out).toMatch(/42k/);
    const res = JSON.parse(
      readFileSync(join(root, `results/${ev}/event-results.json`), "utf8"),
    ) as EventResults;
    expect(res.rows.map((x) => x.slug)).toEqual(["model-a", "model-b", "model-c"]);
    expect(res.rows[2]!.raceStatus).toBe("DNF: ECU FAILURE");
    expect(res.referenceLap).toBeGreaterThan(60);
    expect(res.rows[0]!.gapToReference!).toBeGreaterThan(0);
    const m = JSON.parse(readFileSync(join(root, `results/${ev}/model-a/manifest.json`), "utf8"));
    expect(m.results.raceHash).toBe(res.rows[0]!.raceHash);
    expect(m.driverHash).toBe(res.rows[0]!.driverHash);

    const rep = await cli("event", "reproduce", ev);
    expect(rep.code).toBe(0);
    expect(rep.out).toMatch(/REPRODUCED/);

    res.raceStateHash = "0000";
    res.simVersion = "0.0.0";
    writeFileSync(join(root, `results/${ev}/event-results.json`), JSON.stringify(res));
    const bad = await cli("event", "reproduce", ev);
    expect(bad.code).toBe(3);
    expect(bad.out).toMatch(/DIFF race/);
    expect(bad.out).toMatch(/note: stored sim 0.0.0/);

    const lb = await cli("leaderboard", join(root, "results"));
    expect(lb.out).toMatch(/# Leaderboard/);
    expect(lb.out).toMatch(/\| 1 +\| Model A +\| 10 /);
    expect(existsSync(join(root, "results/leaderboard.md"))).toBe(true);
  });
  it("leaderboard on an empty directory", () => {
    expect(leaderboard(mkdtempSync(join(tmpdir(), "empty-"))).text).toMatch(/no event-results/);
  });
});

describe("agentic workspace and practice service", () => {
  it("creates an isolated workspace and practices through the service", async () => {
    const svc = await serve({ port: 0 });
    try {
      const ws = join(root, "ws/m1");
      const w = createWorkspace(ws, { model: "m1", serviceUrl: svc.url, track: "proto-ring", budget: 2 });
      for (const f of [
        "DRIVER_SPEC.md",
        "driver.d.ts",
        "driver.js",
        "TASK.md",
        "bench.mjs",
        ".bench.json",
        "tracks/proto-ring.json",
      ])
        expect(existsSync(join(ws, f))).toBe(true);
      expect(existsSync(join(ws, "cars"))).toBe(false);
      expect(readFileSync(join(ws, "car-public.json"), "utf8")).not.toMatch(/ClA|tireFront/);
      expect(readTokens()[w.token]!.budget).toBe(2);

      const node = (args: string[]) => exec("node", ["bench.mjs", ...args], { cwd: ws }).catch((e) => e);
      const status = await node(["status"]);
      expect(status.stdout).toMatch(/used 0 of 2/);
      const v = await node(["validate", "driver.js"]);
      expect(v.stdout).toMatch(/PASS/);
      const p = await node(["practice", "driver.js", "--laps", "1"]);
      expect(p.stdout).toMatch(/PRACTICE on proto-ring/);
      expect(p.stdout).toMatch(/runs\/001/);
      expect(p.stdout).toMatch(/practice runs left: 1/);
      expect(existsSync(join(ws, "runs/001/telemetry.csv"))).toBe(true);
      expect(existsSync(join(ws, "runs/001/driver.js"))).toBe(true);
      writeFileSync(join(ws, "broken.js"), "export function step( {");
      const b = await node(["practice", "broken.js"]);
      expect(b.stdout).toMatch(/load failed/);
      expect(b.code).toBe(2);
      const over = await node(["practice", "driver.js"]);
      expect(over.stderr).toMatch(/budget exhausted/);
      expect((await node(["frob"])).stdout).toMatch(/usage/);
      expect(readTokens()[w.token]!.runs).toHaveLength(1);

      const post = (path: string, body: unknown) =>
        fetch(svc.url + path, {
          method: "POST",
          body: typeof body === "string" ? body : JSON.stringify(body),
        });
      expect((await post("/practice", { token: "nope" })).status).toBe(403);
      expect((await fetch(`${svc.url}/status?token=nope`)).status).toBe(403);
      expect((await fetch(`${svc.url}/other`)).status).toBe(404);
      expect((await post("/practice", "{not json")).status).toBe(400);
      const t2 = registerToken("m2", 5, "fixed-token");
      expect(t2).toBe("fixed-token");
      const big = await post("/practice", { token: t2, source: "x".repeat(3 * 1024 * 1024) });
      expect(big.status).toBe(400);
    } finally {
      await svc.close();
    }
  });
  it("refuses a non-empty directory or a bad slug", () => {
    const d = join(root, "ws/full");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "x"), "");
    expect(() => createWorkspace(d, { model: "m", serviceUrl: "", track: "proto-ring" })).toThrow(
      /not empty/,
    );
    expect(() =>
      createWorkspace(join(root, "ws/x"), { model: "Bad Slug", serviceUrl: "", track: "proto-ring" }),
    ).toThrow(/bad model slug/);
  });
  it("workspace command prints the token", async () => {
    const r = await cli(
      "workspace",
      join(root, "ws/cmd"),
      "--model",
      "m3",
      "--budget",
      "3",
      "--token",
      "tok3",
    );
    expect(r.out).toMatch(/practice token: tok3/);
  });
});

describe("driver identity", () => {
  it("uses the folder name or the manifest", () => {
    expect(driverIdentity("/x/drivers/ev/gpt-x/driver.js")).toEqual({ id: "gpt-x", name: "gpt-x" });
    expect(driverIdentity("/x/foo/my-driver.ts").id).toBe("my-driver");
    expect(driverIdentity("/x/pkg/src/driver.ts").id).toBe("pkg");
    file("drivers/named/n1/manifest.json", JSON.stringify({ name: "Nice Name" }));
    expect(driverIdentity(join(root, "drivers/named/n1/driver.js")).name).toBe("Nice Name");
  });
});
