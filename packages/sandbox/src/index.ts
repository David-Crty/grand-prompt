import { type CarSpec, type DriverRuntime, SURFACE_CODES, type Telemetry, type TrackInfo } from "@bench/sim";
import { buildSync, transformSync } from "esbuild";
import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten";

/**
 * Budgets are counted in interrupt-handler calls. QuickJS polls the handler every ~10k internal
 * operations (a counter, not a clock), so budgets are deterministic.
 */
export interface SandboxOptions {
  memoryLimit: number;
  stackLimit: number;
  initBudget: number;
  stepBudget: number;
  /** Backstop only; normally the op budget fires first. Exceeding it is nondeterministic. */
  wallClockInitMs: number;
  wallClockStepMs: number;
  seed: number;
  /** practice mode: log() is captured. Otherwise log() is a no-op. */
  logging: boolean;
  maxLogLines: number;
  maxLogLineLength: number;
  filename: string;
}

export const DEFAULT_SANDBOX: SandboxOptions = {
  memoryLimit: 64 * 1024 * 1024,
  stackLimit: 1024 * 1024,
  initBudget: 20_000,
  stepBudget: 20,
  wallClockInitMs: 30_000,
  wallClockStepMs: 2_000,
  seed: 1,
  logging: false,
  maxLogLines: 500,
  maxLogLineLength: 300,
  filename: "driver.js",
};

export class BudgetError extends Error {
  constructor(phase: string, budget: number) {
    super(`${phase} exceeded its compute budget (${budget} units)`);
    this.name = "BudgetError";
  }
}

export class DriverLoadError extends Error {
  override name = "DriverLoadError";
}

let qjs: Promise<QuickJSWASMModule> | undefined;
export function loadQuickJS(): Promise<QuickJSWASMModule> {
  qjs ??= getQuickJS();
  return qjs;
}

/** Transpile (TS or JS, ES module) to a script that exposes the exports as `__driver`. */
export function compileDriver(source: string, filename = "driver.js"): string {
  const loader = filename.endsWith(".ts") ? "ts" : "js";
  try {
    return transformSync(source, {
      loader,
      format: "iife",
      globalName: "__driver",
      target: "es2020",
      sourcefile: filename,
      logLevel: "silent",
    }).code;
  } catch (e) {
    const err = e as { errors?: { text: string; location?: { line: number; column: number } }[] };
    const first = err.errors?.[0];
    const where = first?.location ? ` (line ${first.location.line}, column ${first.location.column})` : "";
    throw new DriverLoadError(`syntax error: ${first?.text ?? String(e)}${where}`);
  }
}

/**
 * Bundle a driver entry file into one ES module (resolves relative imports and JSON). Node
 * built-ins and packages are not available to drivers, so importing them fails here.
 */
export function bundleDriverFile(path: string): string {
  try {
    const r = buildSync({
      entryPoints: [path],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      target: "es2020",
      logLevel: "silent",
    });
    return r.outputFiles[0]!.text;
  } catch (e) {
    const err = e as { errors?: { text: string; location?: { file: string; line: number } | null }[] };
    const first = err.errors?.[0];
    const where = first?.location ? ` (${first.location.file}:${first.location.line})` : "";
    throw new DriverLoadError(`${first?.text ?? String(e)}${where}`);
  }
}

/** What a driver can be told it is on: the barrier reads as gravel. */
const SURFACES = SURFACE_CODES.filter((s) => s !== "barrier");
const NON_OBJECT: Record<string, unknown> = {
  null: null,
  undefined: undefined,
  number: 0,
  boolean: false,
  string: "",
};

/** Runs inside the VM before driver code. Captures intrinsics so drivers can't break the bridge. */
function prelude(seed: number): string {
  return `
(function () {
  "use strict";
  var g = globalThis;
  var parse = JSON.parse, stringify = JSON.stringify, isFinite = Number.isFinite;
  var hostLog = g.__host_log;
  delete g.__host_log;
  var a = 0x9e3779b9 | 0, b = 0x243f6a88 | 0, c = 0xb7e15162 | 0, d = ${seed >>> 0} | 0;
  function next() {
    var t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  for (var i = 0; i < 15; i++) next();
  Math.random = next;
  delete g.Date;
  function log() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      try { parts.push(typeof v === "string" ? v : stringify(v)); } catch (e) { parts.push(String(v)); }
    }
    hostLog(parts.join(" "));
  }
  g.log = log;
  g.console = { log: log, info: log, warn: log, error: log, debug: log };
  var surfaces = ${JSON.stringify(SURFACES)};
  var driverStep, driverInit;
  var bridge = {};
  bridge.load = function () {
    var m = g.__driver;
    if (!m || typeof m.step !== "function") throw new Error("driver must export a function step(telemetry)");
    if (m.init !== undefined && typeof m.init !== "function") throw new Error("init must be a function");
    driverStep = m.step;
    driverInit = m.init;
  };
  bridge.callInit = function (trackJson, carJson) {
    if (driverInit) driverInit(parse(trackJson), parse(carJson));
  };
  bridge.callStep = function (telJson, surfaceCode) {
    var t = parse(telJson);
    t.surface = surfaces[surfaceCode];
    var r = driverStep(t);
    if (r === null || typeof r !== "object") return r === null ? "null" : typeof r;
    var out = [r.throttle, r.brake, r.steer];
    for (var i = 0; i < 3; i++) if (typeof out[i] !== "number" || !isFinite(out[i])) out[i] = null;
    return stringify(out);
  };
  Object.freeze(bridge);
  Object.defineProperty(g, "__bridge", { value: bridge, writable: false, configurable: false, enumerable: false });
})();
`;
}

export class SandboxedDriver implements DriverRuntime {
  readonly logs: string[] = [];
  private droppedLogs = 0;
  private rt: QuickJSRuntime;
  private vm: QuickJSContext;
  private bridge: QuickJSHandle;
  private stepFn: QuickJSHandle;
  private initFn: QuickJSHandle;
  private remaining = 0;
  private deadline = 0;
  private wallExceeded = false;
  private disposed = false;
  /** Budget units used by init and the most expensive step so far. */
  readonly usage = { init: 0, stepMax: 0, stepTotal: 0, steps: 0 };
  private used = 0;
  private readonly opts: SandboxOptions;

  private constructor(mod: QuickJSWASMModule, script: string, opts: SandboxOptions) {
    this.opts = opts;
    this.rt = mod.newRuntime();
    this.rt.setMemoryLimit(opts.memoryLimit);
    this.rt.setMaxStackSize(opts.stackLimit);
    this.rt.setInterruptHandler(() => {
      this.used++;
      if (--this.remaining < 0) return true;
      // Date.now only as a backstop: checked rarely, never affects results unless it fires.
      if ((this.used & 63) === 0 && Date.now() > this.deadline) {
        this.wallExceeded = true;
        return true;
      }
      return false;
    });
    this.vm = this.rt.newContext();
    const vm = this.vm;
    const logFn = vm.newFunction("__host_log", (h) => {
      this.log(vm.getString(h));
    });
    vm.setProp(vm.global, "__host_log", logFn);
    logFn.dispose();
    this.run("prelude", opts.initBudget, opts.wallClockInitMs, () =>
      vm.evalCode(prelude(opts.seed), "prelude.js"),
    );
    this.run("load", opts.initBudget, opts.wallClockInitMs, () => vm.evalCode(script, opts.filename));
    this.bridge = vm.getProp(vm.global, "__bridge");
    const load = vm.getProp(this.bridge, "load");
    try {
      this.run("load", opts.initBudget, opts.wallClockInitMs, () => vm.callFunction(load, this.bridge));
    } finally {
      load.dispose();
    }
    this.stepFn = vm.getProp(this.bridge, "callStep");
    this.initFn = vm.getProp(this.bridge, "callInit");
  }

  static async create(source: string, opts: Partial<SandboxOptions> = {}): Promise<SandboxedDriver> {
    const o = { ...DEFAULT_SANDBOX, ...opts };
    const script = compileDriver(source, o.filename);
    const mod = await loadQuickJS();
    try {
      return new SandboxedDriver(mod, script, o);
    } catch (e) {
      if (e instanceof DriverLoadError || e instanceof BudgetError) throw e;
      throw new DriverLoadError((e as Error).message);
    }
  }

  private log(line: string): void {
    if (!this.opts.logging) return;
    if (this.logs.length >= this.opts.maxLogLines) {
      this.droppedLogs++;
      return;
    }
    this.logs.push(
      line.length > this.opts.maxLogLineLength ? `${line.slice(0, this.opts.maxLogLineLength)}…` : line,
    );
  }

  get budgets(): { init: number; step: number } {
    return { init: this.opts.initBudget, step: this.opts.stepBudget };
  }

  get logsDropped(): number {
    return this.droppedLogs;
  }

  private run(
    phase: string,
    budget: number,
    wallMs: number,
    fn: () => ReturnType<QuickJSContext["evalCode"]>,
  ): QuickJSHandle {
    this.remaining = budget;
    this.used = 0;
    this.wallExceeded = false;
    this.deadline = Date.now() + wallMs;
    const res = fn();
    if (res.error) {
      const err = this.vm.dump(res.error) as { name?: string; message?: string } | string;
      res.error.dispose();
      if (this.remaining < 0 || this.wallExceeded) {
        throw new BudgetError(this.wallExceeded ? `${phase} (wall-clock backstop)` : phase, budget);
      }
      const msg =
        typeof err === "object" && err ? `${err.name ?? "Error"}: ${err.message ?? ""}` : String(err);
      throw phase === "load" || phase === "prelude" ? new DriverLoadError(msg) : new Error(msg);
    }
    return res.value;
  }

  init(track: TrackInfo, car: CarSpec): void {
    const vm = this.vm;
    const a = vm.newString(JSON.stringify(track));
    const b = vm.newString(JSON.stringify(car));
    try {
      this.run("init", this.opts.initBudget, this.opts.wallClockInitMs, () =>
        vm.callFunction(this.initFn, this.bridge, a, b),
      ).dispose();
      this.usage.init = this.used;
    } finally {
      a.dispose();
      b.dispose();
    }
  }

  step(t: Telemetry): unknown {
    const vm = this.vm;
    const { surface, ...rest } = t;
    const a = vm.newString(JSON.stringify(rest));
    const b = vm.newNumber(SURFACES.indexOf(surface));
    let out: QuickJSHandle;
    try {
      out = this.run("step", this.opts.stepBudget, this.opts.wallClockStepMs, () =>
        vm.callFunction(this.stepFn, this.bridge, a, b),
      );
    } finally {
      a.dispose();
      b.dispose();
      this.usage.steps++;
      this.usage.stepTotal += this.used;
      if (this.used > this.usage.stepMax) this.usage.stepMax = this.used;
    }
    const s = vm.getString(out);
    out.dispose();
    if (s[0] !== "[") return s in NON_OBJECT ? NON_OBJECT[s] : s;
    const [throttle, brake, steer] = JSON.parse(s) as (number | null)[];
    return { throttle: throttle ?? Number.NaN, brake: brake ?? Number.NaN, steer: steer ?? Number.NaN };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stepFn.dispose();
    this.initFn.dispose();
    this.bridge.dispose();
    this.vm.dispose();
    this.rt.dispose();
  }
}
