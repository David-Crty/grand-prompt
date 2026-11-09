import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleDriverFile, SandboxedDriver, type SandboxOptions } from "@bench/sandbox";
import { type CarConfig, type DriverRuntime, Track, type TrackFile } from "@bench/sim";

/** The repository root (tests point `BENCH_ROOT` at a temporary copy). */
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

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function trackPath(id: string): string {
  return join(repoRoot(), "tracks", `${id}.json`);
}

/** A track by id (`tracks/<id>.json`) or by path to a track file. */
export function loadTrackFile(idOrPath: string): TrackFile {
  const p = idOrPath.endsWith(".json") ? resolve(idOrPath) : trackPath(idOrPath);
  if (!existsSync(p)) throw new Error(`unknown track '${idOrPath}' (looked for ${p})`);
  return readJson<TrackFile>(p);
}

export function loadTrack(idOrPath: string): Track {
  return Track.fromFile(loadTrackFile(idOrPath));
}

export function loadCar(): CarConfig {
  return readJson<CarConfig>(join(repoRoot(), "cars", "proto.json"));
}

/** Short content hash of a driver's bundled source, recorded in results and manifests. */
export function driverHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
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
  hash: string;
  runtime: SandboxedDriver | FailedDriver;
}

/**
 * Id and display name of a driver file: the id is its folder (`drivers/<event>/<slug>/driver.js`) or its
 * file name, the name the `model` of a manifest.json next to it.
 */
export function driverIdentity(path: string): { id: string; name: string } {
  const dir = dirname(resolve(path));
  const file = basename(path).replace(/\.(t|j)s$/, "");
  const id = file === "driver" ? basename(dir) : file;
  const manifest = join(dir, "manifest.json");
  const name = existsSync(manifest) ? readJson<{ model?: string }>(manifest).model : undefined;
  return { id, name: name ?? id };
}

export async function loadDriver(path: string, opts: Partial<SandboxOptions> = {}): Promise<LoadedDriver> {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`driver not found: ${path}`);
  const source = bundleDriverFile(abs);
  const runtime = await SandboxedDriver.create(source, {
    filename: basename(abs).replace(/\.ts$/, ".js"),
    ...opts,
  });
  return { ...driverIdentity(abs), hash: driverHash(source), runtime };
}

/** A single-file driver from source text (practice service). TS is accepted when filename ends in .ts. */
export async function loadDriverSource(
  source: string,
  filename: string,
  id: string,
  opts: Partial<SandboxOptions> = {},
): Promise<LoadedDriver> {
  const runtime = await SandboxedDriver.create(source, { ...opts, filename });
  return { id, name: id, hash: driverHash(source), runtime };
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
    return {
      ...driverIdentity(abs),
      hash: driverHash(existsSync(abs) ? readFileSync(abs, "utf8") : ""),
      runtime: new FailedDriver(`module failed to load: ${(e as Error).message}`),
    };
  }
}
