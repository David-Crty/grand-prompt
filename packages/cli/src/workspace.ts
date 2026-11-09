import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot, trackPath, writeJson } from "./load.js";
import { registerToken } from "./service.js";

export const DEFAULT_PRACTICE_BUDGET = 10;

/** What a model gets from `ddk/`, besides TASK.md, its driver.js and the practice client. */
const DDK_FILES = ["DRIVER_SPEC.md", "driver.d.ts", "baseline-driver.js", "car-public.json"];

export interface WorkspaceOptions {
  model: string;
  serviceUrl: string;
  /** Practice circuits; the event circuit must not be one of them. */
  tracks: string[];
  budget?: number;
}

/**
 * An isolated workspace for an agentic build: the DDK, the practice circuits, a starting driver and a
 * practice client (`bench.mjs`) that talks to `bench serve`. No sim source and no hidden constants.
 */
export function createWorkspace(dir: string, opts: WorkspaceOptions): { dir: string; token: string } {
  const abs = resolve(dir);
  if (existsSync(abs) && readdirSync(abs).length) throw new Error(`workspace dir not empty: ${abs}`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(opts.model)) throw new Error(`bad model slug '${opts.model}'`);
  if (!opts.tracks.length) throw new Error("workspace needs at least one practice track");
  for (const t of opts.tracks) if (!existsSync(trackPath(t))) throw new Error(`unknown track '${t}'`);
  const ddk = join(repoRoot(), "ddk");
  mkdirSync(join(abs, "tracks"), { recursive: true });
  for (const f of DDK_FILES) copyFileSync(join(ddk, f), join(abs, f));
  copyFileSync(join(ddk, "baseline-driver.js"), join(abs, "driver.js"));
  copyFileSync(join(ddk, "bench-client.mjs"), join(abs, "bench.mjs"));
  const task = readFileSync(join(ddk, "PROMPT_AGENTIC.md"), "utf8");
  writeFileSync(
    join(abs, "TASK.md"),
    task.replace("{{PRACTICE_TRACKS}}", opts.tracks.map((t) => `\`${t}\``).join(", ")),
  );
  for (const t of opts.tracks) copyFileSync(trackPath(t), join(abs, "tracks", `${t}.json`));
  const token = registerToken(opts.model, opts.budget ?? DEFAULT_PRACTICE_BUDGET, opts.tracks);
  writeJson(join(abs, ".bench.json"), { serviceUrl: opts.serviceUrl, token, tracks: opts.tracks });
  return { dir: abs, token };
}
