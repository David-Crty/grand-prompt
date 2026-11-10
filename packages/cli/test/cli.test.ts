// Feature tests for the bench CLI: real sandboxed sessions, events, the practice service.
import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createWorkspace,
  driverIdentity,
  type EventResults,
  readReplay,
  readTokens,
  registerToken,
  run,
  serve,
  USAGE,
} from "../src/index.js";

const exec = promisify(execFile);
const repo = new URL("../../../", import.meta.url).pathname;
let root: string;
let prevRoot: string | undefined;

const baselineSrc = readFileSync(join(repo, "driver-development-kit/baseline-driver.js"), "utf8");
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
  for (const d of ["tracks", "cars", "driver-development-kit"])
    cpSync(join(repo, d), join(root, d), { recursive: true });
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
    await expect(cli("validate", "x.js", "--seed", "abc")).rejects.toThrow(/--seed is a number/);
    await expect(cli("build")).rejects.toThrow(/missing <event>/);
    await expect(cli("race")).rejects.toThrow(/missing <event>/);
    await expect(cli("reproduce")).rejects.toThrow(/missing <event>/);
    await expect(cli("workspace", "/tmp/nope")).rejects.toThrow(/--event/);
    await expect(cli("workspace", "/tmp/nope", "--event", "ev")).rejects.toThrow(/--model/);
    await expect(cli("practice", "missing.js")).rejects.toThrow(/driver not found/);
    await expect(
      cli("practice", join(root, "driver-development-kit/baseline-driver.js"), "--track", "atlantis"),
    ).rejects.toThrow(/unknown track/);
  });
});

describe("validate", () => {
  it("passes the baseline", async () => {
    const r = await cli("validate", join(root, "driver-development-kit/baseline-driver.js"));
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
        "export function step(t) { log('hi', t.t); if (t.lapTime > 1) throw new Error('late'); return {throttle:0.3,brake:0,steer:0}; }",
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
    const r = await cli("practice", join(root, "driver-development-kit/baseline-driver.js"), "--out", out);
    expect(r.out).toMatch(/FLYING LAP on proto-ring/);
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
    expect(readFileSync(join(out, "telemetry.csv"), "utf8").split("\n")[0]).toMatch(/^t,s,speed/);
    // default output directory numbering
    const auto = await cli("practice", join(root, "driver-development-kit/baseline-driver.js"));
    expect(auto.out).toMatch(/baseline-driver-001/);
  });
});

describe("tracks import", () => {
  it("rebuilds the committed circuits byte for byte from tracks/sources/", async () => {
    const r = await cli("tracks", "import");
    for (const id of ["monaco", "portimao", "silverstone", "barcelona"]) {
      expect(r.out).toMatch(new RegExp(`^${id}: \\d+ points, \\d+ m`, "m"));
      expect(readFileSync(join(root, `tracks/${id}.json`), "utf8")).toBe(
        readFileSync(join(repo, `tracks/${id}.json`), "utf8"),
      );
    }
  });
});

describe("races", () => {
  const event = (ev: string, drivers: Record<string, string>) => {
    file(`drivers/${ev}/event.json`, JSON.stringify({ name: `${ev} GP`, seed: 4 }));
    for (const [slug, src] of Object.entries(drivers)) file(`drivers/${ev}/${slug}/driver.js`, src);
  };

  it("lists the circuits and races an event on one of them", async () => {
    const list = (await cli("tracks")).out;
    for (const id of ["monaco", "portimao", "proto-ring", "silverstone"])
      expect(list).toMatch(new RegExp(`^${id} `, "m"));
    expect(list).toMatch(/Monaco\s+3\.\d{3} km/);
    event("ev-one", { "model-a": baselineSrc });
    const out = join(root, "elsewhere");
    const r = await cli("race", "ev-one", "--track", "monaco", "--out", out);
    expect(r.out).toMatch(/ev-one GP \(ev-one\) on monaco, flying lap, seed 4/);
    expect(r.out).toMatch(/\| 1 +\| model-a +\| \d:\d\d\.\d{3} \| FINISHED/);
    const replay = readReplay(join(out, "monaco", "ev-one", "replay.json.gz"));
    expect(replay.header.trackId).toBe("monaco");
    expect(replay.header.seed).toBe(4);
    writeFileSync(join(out, "plain.json"), JSON.stringify(replay));
    expect(readReplay(join(out, "plain.json")).header.stateHash).toBe(replay.header.stateHash);
  });

  it("races an event on every circuit by default", async () => {
    event("ev-all", { broken: "export function step( {" });
    const r = await cli("race", "ev-all");
    for (const t of readdirSync(join(root, "tracks")).filter((f) => f.endsWith(".json"))) {
      const id = t.slice(0, -5);
      expect(r.out).toMatch(new RegExp(`on ${id}, flying lap`));
      expect(existsSync(join(root, `results/races/${id}/ev-all/replay.json.gz`))).toBe(true);
    }
  });

  it("reproduces an event's races", async () => {
    const ev = "ev-test";
    event(ev, { "model-a": baselineSrc, "model-b": slower, "model-c": "export function step( {" });
    file(
      `drivers/${ev}/model-a/manifest.json`,
      JSON.stringify({ model: "Model A", usage: { inputTokens: 30000, outputTokens: 12000, costUsd: 0.42 } }),
    );
    file(`drivers/${ev}/not-a-driver/readme.txt`, "x");
    await expect(cli("reproduce", ev)).rejects.toThrow(/no races of 'ev-test'/);
    const r = await cli("race", ev, "--track", "proto-ring");
    expect(r.out).toMatch(/\| 1 +\| Model A +\| 1:\d\d\.\d{3} \| FINISHED/);
    expect(r.out).toMatch(/\$0\.42/);
    expect(r.out).toMatch(/42k/);
    const path = join(root, `results/races/proto-ring/${ev}/event-results.json`);
    const res = JSON.parse(readFileSync(path, "utf8")) as EventResults;
    expect(res.event).toEqual({ id: ev, name: "ev-test GP", seed: 4 });
    expect(res.track).toBe("proto-ring");
    expect(res.rows.map((x) => x.slug)).toEqual(["model-a", "model-b", "model-c"]);
    expect(res.rows[0]!.manifest?.usage?.costUsd).toBe(0.42);
    expect(res.rows[1]!.manifest).toBeNull();
    expect(res.rows[2]!.status).toBe("DNF: ECU FAILURE");

    const rep = await cli("reproduce", ev);
    expect(rep.code).toBe(0);
    expect(rep.out).toMatch(/^proto-ring$/m);
    expect(rep.out).toMatch(/REPRODUCED/);

    res.stateHash = "0000";
    res.simVersion = "0.0.0";
    writeFileSync(path, JSON.stringify(res));
    const bad = await cli("reproduce", ev);
    expect(bad.code).toBe(3);
    expect(bad.out).toMatch(/DIFF race/);
    expect(bad.out).toMatch(/note: stored sim 0.0.0/);

    await expect(cli("race", "nope")).rejects.toThrow(/no event 'nope'/);
  });
});

describe("agentic workspace and practice service", () => {
  it("creates an isolated workspace and practices through the service", async () => {
    const svc = await serve({ port: 0 });
    try {
      const ws = join(root, "ws/m1");
      const w = createWorkspace(ws, {
        event: "ev",
        model: "m1",
        serviceUrl: svc.url,
        tracks: ["proto-ring", "monaco"],
        budget: 2,
      });
      for (const f of [
        "DRIVER_SPEC.md",
        "driver.d.ts",
        "driver.js",
        "TASK.md",
        "bench.mjs",
        ".bench.json",
        "tracks/proto-ring.json",
        "tracks/monaco.json",
      ])
        expect(existsSync(join(ws, f))).toBe(true);
      expect(existsSync(join(ws, "tracks/silverstone.json"))).toBe(false);
      expect(readFileSync(join(ws, "TASK.md"), "utf8")).toMatch(/practice circuits: `proto-ring`, `monaco`/);
      expect(existsSync(join(ws, "cars"))).toBe(false);
      expect(readFileSync(join(ws, "car-public.json"), "utf8")).not.toMatch(/ClA|tireFront/);
      expect(readTokens()[w.token]!.budget).toBe(2);

      const node = (args: string[]) => exec("node", ["bench.mjs", ...args], { cwd: ws }).catch((e) => e);
      const status = await node(["status"]);
      expect(status.stdout).toMatch(/used 0 of 2/);
      expect(status.stdout).toMatch(/practice circuits: proto-ring, monaco/);
      const hidden = await node(["validate", "driver.js", "--track", "silverstone"]);
      expect(hidden.stderr).toMatch(
        /'silverstone' is not a practice circuit \(available: proto-ring, monaco\)/,
      );
      const v = await node(["validate", "driver.js"]);
      expect(v.stdout).toMatch(/PASS/);
      const p = await node(["practice", "driver.js", "--track", "monaco"]);
      expect(p.stdout).toMatch(/FLYING LAP on monaco/);
      expect(p.stdout).toMatch(/runs\/001/);
      expect(p.stdout).toMatch(/practice runs left: 1/);
      expect(existsSync(join(ws, "runs/001/telemetry.csv"))).toBe(true);
      expect(existsSync(join(ws, "runs/001/driver.js"))).toBe(true);
      expect(existsSync(join(root, "results/agentic/ev/m1/practice-001/telemetry.csv"))).toBe(true);
      expect(existsSync(join(root, "results/agentic/ev/m1/validate/driver.js"))).toBe(true);
      writeFileSync(join(ws, "broken.js"), "export function step( {");
      const b = await node(["practice", "broken.js"]);
      expect(b.stdout).toMatch(/load failed/);
      expect(b.code).toBe(2);
      const over = await node(["practice", "driver.js"]);
      expect(over.stderr).toMatch(/budget exhausted/);
      expect((await node(["frob"])).stdout).toMatch(/usage/);
      expect(readTokens()[w.token]!.runs).toHaveLength(1);
      expect(readTokens()[w.token]!.runs[0]!.track).toBe("monaco");

      const post = (path: string, body: unknown) =>
        fetch(svc.url + path, {
          method: "POST",
          body: typeof body === "string" ? body : JSON.stringify(body),
        });
      expect((await post("/practice", { token: "nope" })).status).toBe(403);
      expect((await fetch(`${svc.url}/status?token=nope`)).status).toBe(403);
      expect((await fetch(`${svc.url}/other`)).status).toBe(404);
      expect((await post("/practice", "{not json")).status).toBe(400);
      const t2 = registerToken("ev", "m2", 5, ["proto-ring"]);
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
    expect(() =>
      createWorkspace(d, { event: "ev", model: "m", serviceUrl: "", tracks: ["proto-ring"] }),
    ).toThrow(/not empty/);
    expect(() =>
      createWorkspace(join(root, "ws/x"), {
        event: "ev",
        model: "Bad Slug",
        serviceUrl: "",
        tracks: ["proto-ring"],
      }),
    ).toThrow(/bad model slug/);
    expect(() =>
      createWorkspace(join(root, "ws/e"), {
        event: "../up",
        model: "m",
        serviceUrl: "",
        tracks: ["proto-ring"],
      }),
    ).toThrow(/bad event name/);
    expect(() =>
      createWorkspace(join(root, "ws/y"), { event: "ev", model: "m", serviceUrl: "", tracks: [] }),
    ).toThrow(/at least one practice track/);
    expect(() =>
      createWorkspace(join(root, "ws/z"), { event: "ev", model: "m", serviceUrl: "", tracks: ["nowhere"] }),
    ).toThrow(/unknown track 'nowhere'/);
  });
  it("workspace command prints the token", async () => {
    const r = await cli(
      "workspace",
      join(root, "ws/cmd"),
      "--event",
      "ev",
      "--model",
      "m3",
      "--track",
      "monaco",
      "--budget",
      "3",
    );
    const token = r.out.match(/practice token: (\w+)/)![1]!;
    expect(readTokens()[token]).toMatchObject({ event: "ev", model: "m3", budget: 3, tracks: ["monaco"] });
  });
});

describe("driver identity", () => {
  it("uses the folder name or the manifest", () => {
    expect(driverIdentity("/x/drivers/ev/gpt-x/driver.js")).toEqual({ id: "gpt-x", name: "gpt-x" });
    expect(driverIdentity("/x/foo/my-driver.ts").id).toBe("my-driver");
    file("drivers/named/n1/manifest.json", JSON.stringify({ model: "Nice Name" }));
    expect(driverIdentity(join(root, "drivers/named/n1/driver.js")).name).toBe("Nice Name");
  });
});
