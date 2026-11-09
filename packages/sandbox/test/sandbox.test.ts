import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CarSim, runSession, type Telemetry } from "@bench/sim";
import { describe, expect, it } from "vitest";
import { protoCar, protoRing } from "../../sim/test/helpers.js";
import {
  BudgetError,
  bundleDriverFile,
  compileDriver,
  DriverLoadError,
  SandboxedDriver,
} from "../src/index.js";

const tel: Telemetry = {
  t: 0,
  lap: 1,
  lapTime: 0,
  sector: 1,
  s: 0,
  n: 0,
  headingError: 0,
  x: 0,
  y: 0,
  yaw: 0,
  speed: 0,
  vx: 0,
  vy: 0,
  yawRate: 0,
  ax: 0,
  ay: 0,
  steer: 0,
  throttle: 0,
  brake: 0,
  surface: "kerb",
  offTrackWarnings: 0,
};
const info = () => protoRing().toInfo();
const spec = { infoLevel: "B" as const, ...protoCar().public };
const ok = "return { throttle: 0.5, brake: 0, steer: 0 };";

async function drv(body: string, opts = {}) {
  const d = await SandboxedDriver.create(
    `export function init(track, car) {} export function step(t) { ${body} }`,
    opts,
  );
  d.init(info(), spec);
  return d;
}

describe("sandbox basics", () => {
  it("runs init and step and passes telemetry through", async () => {
    const d = await SandboxedDriver.create(`
      let n = 0, len = 0;
      export function init(track, car) { len = track.length + car.mass; }
      export function step(t) { n++; return { throttle: t.surface === "kerb" ? 1 : 0, brake: len, steer: n }; }
    `);
    d.init(info(), spec);
    expect(d.step(tel)).toEqual({ throttle: 1, brake: protoRing().length + 800, steer: 1 });
    expect(d.step(tel)).toEqual({ throttle: 1, brake: protoRing().length + 800, steer: 2 });
    expect(d.usage.steps).toBe(2);
    expect(d.budgets).toEqual({ init: 20000, step: 20 });
    d.dispose();
    d.dispose();
  });

  it("accepts TypeScript", async () => {
    const d = await SandboxedDriver.create(
      "interface C { throttle: number; brake: number; steer: number }\nexport function step(t: unknown): C { return { throttle: 1, brake: 0, steer: 0 }; }",
      { filename: "driver.ts" },
    );
    d.init(info(), spec);
    expect(d.step(tel)).toEqual({ throttle: 1, brake: 0, steer: 0 });
  });

  it("reports syntax errors and missing exports as load errors", async () => {
    await expect(SandboxedDriver.create("export function step( {")).rejects.toThrow(DriverLoadError);
    await expect(SandboxedDriver.create("export function step( {")).rejects.toThrow(/line 1/);
    await expect(SandboxedDriver.create("export const x = 1;")).rejects.toThrow(
      /must export a function step/,
    );
    await expect(SandboxedDriver.create("export const init = 3; export function step() {}")).rejects.toThrow(
      /init must be a function/,
    );
    await expect(SandboxedDriver.create("throw new Error('top-level')")).rejects.toThrow(/top-level/);
    expect(() => compileDriver("let = ;")).toThrow(DriverLoadError);
  });

  it("maps invalid outputs so the sim can strike them", async () => {
    const d = await SandboxedDriver.create(`
      let i = 0;
      const outs = [null, undefined, 5, "x", true, { throttle: NaN, brake: Infinity, steer: "1" }];
      export function step() { return outs[i++]; }`);
    d.init(info(), spec);
    expect(d.step(tel)).toBeNull();
    expect(d.step(tel)).toBeUndefined();
    expect(d.step(tel)).toBe(0);
    expect(d.step(tel)).toBe("");
    expect(d.step(tel)).toBe(false);
    const r = d.step(tel) as Record<string, number>;
    expect(Number.isNaN(r.throttle)).toBe(true);
    expect(Number.isNaN(r.brake)).toBe(true);
    expect(Number.isNaN(r.steer)).toBe(true);
  });
});

describe("sandbox isolation (adversarial drivers)", () => {
  it("has no host APIs", async () => {
    const d = await drv(
      `
      const r = [typeof process, typeof require, typeof fetch, typeof Date, typeof setTimeout, typeof globalThis.__host_log];
      log(r.join(","));
      return { throttle: r.every((x) => x === "undefined") ? 1 : 0, brake: 0, steer: 0 };`,
      { logging: true },
    );
    expect((d.step(tel) as { throttle: number }).throttle).toBe(1);
  });

  it("accessing host APIs throws inside the sandbox (a strike, not an escape)", async () => {
    const d = await drv(`return process.exit(1);`);
    expect(() => d.step(tel)).toThrow(/process/);
  });

  it("seeds Math.random", async () => {
    const seq = async (seed: number) => {
      const d = await drv("return { throttle: Math.random(), brake: 0, steer: 0 };", { seed });
      return [0, 1, 2].map(() => (d.step(tel) as { throttle: number }).throttle);
    };
    expect(await seq(5)).toEqual(await seq(5));
    expect(await seq(5)).not.toEqual(await seq(6));
  });

  it("globalThis tampering cannot break the bridge", async () => {
    const d = await drv(`
      JSON.parse = () => ({ evil: true });
      JSON.stringify = () => "[1,1,1]";
      Object.prototype.throttle = 9;
      try { delete globalThis.__bridge; } catch (e) {}
      try { globalThis.__bridge = null; } catch (e) {}
      return { throttle: typeof t.speed === "number" ? 0.25 : 0, brake: 0, steer: 0 };`);
    expect(d.step(tel)).toEqual({ throttle: 0.25, brake: 0, steer: 0 });
    expect(d.step(tel)).toEqual({ throttle: 0.25, brake: 0, steer: 0 });
  });

  it("an infinite loop in step exceeds the budget", async () => {
    const d = await drv("for (;;) {}");
    expect(() => d.step(tel)).toThrow(BudgetError);
    // the VM survives and the next call works
    const d2 = await drv(`if (t.t > 0) { ${ok} } for (;;) {}`);
    expect(() => d2.step(tel)).toThrow(BudgetError);
    expect(d2.step({ ...tel, t: 1 })).toEqual({ throttle: 0.5, brake: 0, steer: 0 });
  });

  it("an infinite loop in init or at load time exceeds the init budget", async () => {
    const d = await SandboxedDriver.create(
      `export function init() { while (true) {} } export function step() {}`,
      {
        initBudget: 50,
      },
    );
    expect(() => d.init(info(), spec)).toThrow(BudgetError);
    await expect(
      SandboxedDriver.create("while (true) {} export function step() {}", { initBudget: 50 }),
    ).rejects.toThrow(BudgetError);
  });

  it("budget usage is deterministic", async () => {
    const use = async () => {
      const d = await drv(`let s = 0; for (let i = 0; i < 30000 * (1 + (t.t % 3)); i++) s += i; ${ok}`);
      for (let k = 0; k < 6; k++) d.step({ ...tel, t: k });
      return { ...d.usage };
    };
    const a = await use();
    expect(a).toEqual(await use());
    expect(a.stepMax).toBeGreaterThan(0);
  });

  it("the wall-clock backstop fires if the op budget is huge", async () => {
    const d = await SandboxedDriver.create("export function step() { for(;;){} }", {
      stepBudget: 1e12,
      wallClockStepMs: 50,
    });
    d.init(info(), spec);
    expect(() => d.step(tel)).toThrow(/wall-clock/);
  });

  it("a memory bomb hits the memory limit", async () => {
    const d = await drv("const a = []; for (;;) a.push(new Array(100000).fill(1.5));", {
      memoryLimit: 16 * 1024 * 1024,
      stepBudget: 1e6,
    });
    expect(() => d.step(tel)).toThrow(/memory/i);
  });

  it("deep recursion hits the stack limit", async () => {
    const d = await drv("const f = (n) => f(n + 1) + 1; return f(0);");
    expect(() => d.step(tel)).toThrow(/stack/i);
  });

  it("throwing in init/step surfaces the error message", async () => {
    const d = await SandboxedDriver.create(
      "export function init() { throw new TypeError('nope'); } export function step() { throw 'raw'; }",
    );
    expect(() => d.init(info(), spec)).toThrow(/TypeError: nope/);
    expect(() => d.step(tel)).toThrow(/raw/);
  });
});

describe("logging", () => {
  it("captures logs in practice mode, rate limited", async () => {
    const d = await drv(
      `log("t", t.t, { a: 1 }); console.log("x".repeat(1000)); const c = {}; c.c = c; log(c); ${ok}`,
      {
        logging: true,
        maxLogLines: 4,
      },
    );
    d.step(tel);
    d.step(tel);
    expect(d.logs[0]).toBe('t 0 {"a":1}');
    expect(d.logs[1]!.length).toBeLessThan(400);
    expect(d.logs[2]).toBe("[object Object]");
    expect(d.logs).toHaveLength(4);
    expect(d.logsDropped).toBe(2);
  });
  it("log is a no-op outside practice", async () => {
    const d = await drv(`log("hidden"); ${ok}`);
    d.step(tel);
    expect(d.logs).toHaveLength(0);
  });
});

describe("bundling", () => {
  it("bundles relative imports and JSON, rejects Node built-ins", () => {
    const dir = mkdtempSync(join(tmpdir(), "drv-"));
    writeFileSync(join(dir, "k.json"), '{"gain": 2}');
    writeFileSync(join(dir, "util.js"), "export const half = (x) => x / 2;");
    writeFileSync(
      join(dir, "driver.js"),
      'import k from "./k.json"; import { half } from "./util.js"; export function step() { return { throttle: half(k.gain), brake: 0, steer: 0 }; }',
    );
    const src = bundleDriverFile(join(dir, "driver.js"));
    expect(src).toMatch(/gain/);
    writeFileSync(join(dir, "bad.js"), 'import fs from "node:fs"; export function step() {}');
    expect(() => bundleDriverFile(join(dir, "bad.js"))).toThrow(DriverLoadError);
  });
});

describe("feature: sandboxed drivers in the sim", () => {
  it("a budget overrun in step is a strike, three are an ECU failure", async () => {
    const d = await SandboxedDriver.create(
      `export function step(t) { if (t.lapTime > 1) for(;;){} return { throttle: 0.4, brake: 0, steer: 0 }; }`,
    );
    const run = new CarSim(protoRing(), protoCar(), { id: "x", name: "x", runtime: d }, { seed: 1 }).run();
    expect(run.result.status).toBe("DNF: ECU FAILURE");
    expect(run.result.errors[0]).toMatch(/compute budget/);
  });

  it("the sandboxed baseline is deterministic across runs", async () => {
    const src = bundleDriverFile(new URL("../../../ddk/baseline-driver.js", import.meta.url).pathname);
    const hash = async () => {
      const d = await SandboxedDriver.create(src);
      return runSession(protoRing(), protoCar(), [{ id: "b", name: "b", runtime: d }], { seed: 1 }).results;
    };
    const a = await hash();
    const b = await hash();
    expect(a.stateHash).toBe(b.stateHash);
    expect(a.classification[0]!.status).toBe("FINISHED");
  });
});
