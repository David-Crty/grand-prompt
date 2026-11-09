import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  driverIdentity,
  type EventResults,
  eventTable,
  type FailedDriver,
  listEventDrivers,
  loadCar,
  loadDriverOrFailed,
  loadTrack,
  registerToken,
  repoRoot,
  serve,
  table,
} from "../src/index.js";

type Json = Record<string, unknown> & { text: string };
const repo = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");

describe("loading", () => {
  it("finds the repo root without BENCH_ROOT and loads tracks by path", () => {
    const prev = process.env.BENCH_ROOT;
    delete process.env.BENCH_ROOT;
    try {
      expect(repoRoot()).toBe(repo);
      expect(loadTrack(join(repo, "tracks/proto-ring.json")).id).toBe("proto-ring");
      expect(loadCar().id).toBe("proto-ow");
      expect(listEventDrivers("no-such-event")).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.BENCH_ROOT = prev;
    }
  });
  it("names a driver from a manifest model field, and survives a missing file", async () => {
    const d = mkdtempSync(join(tmpdir(), "id-"));
    writeFileSync(join(d, "manifest.json"), JSON.stringify({ model: "Model X" }));
    expect(driverIdentity(join(d, "driver.js")).name).toBe("Model X");
    const f = await loadDriverOrFailed(join(d, "missing.js"));
    const rt = f.runtime as FailedDriver;
    expect(() => rt.init()).toThrow(/driver not found/);
    expect(rt.step()).toBeNull();
    f.runtime.dispose();
  });
});

describe("tables", () => {
  it("formats lap times, missing tokens and costs", () => {
    const res = {
      event: { id: "e", name: "E", track: "t", seed: 1 },
      rows: [
        {
          position: 1,
          name: "A",
          manifest: { model: "A", usage: { costUsd: 1 } },
          lapTime: 70,
          status: "FINISHED",
        },
        {
          position: 2,
          name: "B",
          manifest: { model: "B", usage: { outputTokens: 2000 } },
          lapTime: null,
          status: "DNF: CRASHED",
        },
        { position: 3, name: "C", manifest: null, lapTime: null, status: "DNF: STALLED" },
      ],
    } as unknown as EventResults;
    const t = eventTable(res);
    expect(t).toMatch(/E \(e\) on t, flying lap, seed 1/);
    expect(t).toMatch(/\| 1:10\.000 /);
    expect(t).toMatch(/\| 2k /);
    expect(t).toMatch(/\$1\.00/);
    expect(t).toMatch(/\| C +\| - +\| DNF: STALLED \| - +\| - /);
    expect(
      table([
        ["a", "bb"],
        ["ccc", "d"],
      ]),
    ).toBe("| a   | bb |\n|-----|----|\n| ccc | d  |");
  });
});

describe("practice service edge cases", () => {
  it("validates TypeScript, keeps to the token's circuits, needs a token", async () => {
    const root = mkdtempSync(join(tmpdir(), "svc-"));
    const prev = process.env.BENCH_ROOT;
    process.env.BENCH_ROOT = root;
    for (const dir of ["tracks", "cars", "ddk"])
      cpSync(join(repo, dir), join(root, dir), { recursive: true });
    const tok = registerToken("ts-model", 3, ["proto-ring", "monaco"]);
    const svc = await serve({ port: 0 });
    try {
      const post = (path: string, body?: unknown) =>
        fetch(svc.url + path, { method: "POST", body: body === undefined ? "" : JSON.stringify(body) });
      expect((await post("/practice")).status).toBe(403);
      expect((await fetch(`${svc.url}/status`)).status).toBe(403);
      const ts =
        "export function step(t: { speed: number }) { return { throttle: 0.3, brake: 0, steer: 0 }; }";
      const v = (await (
        await post("/validate", { token: tok, source: ts, filename: "x.ts" })
      ).json()) as Json;
      expect(v.ok).toBe(true);
      const sneaky = await post("/validate", { token: tok, source: ts, track: "../etc/passwd" });
      expect(sneaky.status).toBe(403);
      const base = readFileSync(join(repo, "ddk/baseline-driver.js"), "utf8");
      const p = (await (await post("/practice", { token: tok, source: base })).json()) as Json;
      expect(p.ok).toBe(true);
      expect(p.text).toMatch(/FLYING LAP on proto-ring/);
      const lp = (await (
        await post("/practice", { token: tok, source: base, track: "monaco" })
      ).json()) as Json;
      expect(lp.text).toMatch(/FLYING LAP on monaco/);
      const st = await (await fetch(`${svc.url}/status?token=${tok}`)).json();
      expect(st).toMatchObject({ model: "ts-model", used: 2, left: 1, tracks: ["proto-ring", "monaco"] });
    } finally {
      await svc.close();
      if (prev === undefined) delete process.env.BENCH_ROOT;
      else process.env.BENCH_ROOT = prev;
    }
  });
});
