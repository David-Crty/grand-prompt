import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleDriverFile, SandboxedDriver, type SandboxOptions } from "@bench/sandbox";
import { type CarConfig, type DriverRuntime, Track, type TrackFile } from "@bench/sim";

export function repoRoot(): string {
  if (process.env.BENCH_ROOT) return resolve(process.env.BENCH_ROOT);
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, "tracks")) && existsSync(join(d, "cars"))) return d;
    d = dirname(d);
  }
  throw new Error("cannot locate the bench root (set BENCH_ROOT)");
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadTrackFile(idOrPath: string): TrackFile {
  const p = idOrPath.endsWith(".json") ? resolve(idOrPath) : join(repoRoot(), "tracks", `${idOrPath}.json`);
  if (!existsSync(p)) throw new Error(`unknown track '${idOrPath}' (looked for ${p})`);
  return readJson<TrackFile>(p);
}

export function loadTrack(idOrPath: string): Track {
  return Track.fromFile(loadTrackFile(idOrPath));
}

export function loadCar(path?: string): CarConfig {
  return readJson<CarConfig>(path ? resolve(path) : join(repoRoot(), "cars", "proto.json"));
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Stand-in for a driver whose module failed to load: its init throws, so the car is an ECU failure. */
export class FailedDriver implements DriverRuntime {
  readonly usage = { init: 0, stepMax: 0, stepTotal: 0, steps: 0 };
  readonly logs: string[] = [];
  readonly logsDropped = 0;
  readonly budgets = { init: 0, step: 0 };
  constructor(readonly message: string) {}
  init(): void {
    throw new Error(this.message);
  }
  step(): unknown {
    return null;
  }
  dispose(): void {}
}

export interface LoadedDriver {
  id: string;
  name: string;
  path: string;
  source: string;
  hash: string;
  runtime: SandboxedDriver | FailedDriver;
}

/** Display name: `model` from a manifest.json next to the driver, else the folder name. */
export function driverIdentity(path: string): { id: string; name: string } {
  const dir = dirname(resolve(path));
  const manifest = join(dir, "manifest.json");
  const file = basename(path).replace(/\.(t|j)s$/, "");
  const folder = basename(dir) === "src" ? basename(dirname(dir)) : basename(dir);
  const id = file === "driver" ? folder : file;
  if (existsSync(manifest)) {
    const m = readJson<{ model?: string; name?: string }>(manifest);
    return { id, name: m.name ?? m.model ?? id };
  }
  return { id, name: id };
}

export const REFERENCE_PATH = "packages/reference-driver/src/driver.ts";

export async function loadDriver(path: string, opts: Partial<SandboxOptions> = {}): Promise<LoadedDriver> {
  const abs = isAbsolute(path) ? path : resolve(path);
  if (!existsSync(abs)) throw new Error(`driver not found: ${path}`);
  const source = bundleDriverFile(abs);
  const runtime = await SandboxedDriver.create(source, {
    filename: basename(abs).replace(/\.ts$/, ".js"),
    ...opts,
  });
  return { ...driverIdentity(abs), path: abs, source, hash: sha256(source).slice(0, 16), runtime };
}

/** Load a single-file driver from source text (practice service). TS is accepted when filename ends in .ts. */
export async function loadDriverSource(
  source: string,
  filename: string,
  id: string,
  opts: Partial<SandboxOptions> = {},
): Promise<LoadedDriver> {
  const runtime = await SandboxedDriver.create(source, { ...opts, filename });
  return { id, name: id, path: filename, source, hash: sha256(source).slice(0, 16), runtime };
}

/** Like loadDriver, but a module that fails to load becomes a FailedDriver instead of throwing. */
export async function loadDriverOrFailed(
  path: string,
  opts: Partial<SandboxOptions> = {},
): Promise<LoadedDriver> {
  try {
    return await loadDriver(path, opts);
  } catch (e) {
    const abs = resolve(path);
    const raw = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    return {
      ...driverIdentity(abs),
      path: abs,
      source: raw,
      hash: sha256(raw).slice(0, 16),
      runtime: new FailedDriver(`module failed to load: ${(e as Error).message}`),
    };
  }
}

export async function loadReference(opts: Partial<SandboxOptions> = {}): Promise<LoadedDriver> {
  const d = await loadDriver(join(repoRoot(), REFERENCE_PATH), opts);
  return { ...d, id: "reference", name: "Reference (house)" };
}
