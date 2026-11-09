import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "./load.js";
import { registerToken } from "./service.js";

export const DEFAULT_PRACTICE_BUDGET = 10;

export const WORKSPACE_FILES = ["DRIVER_SPEC.md", "driver.d.ts", "baseline-driver.js", "car-public.json"];

/**
 * An isolated workspace for an agentic run: the DDK, a starting driver and a practice client that
 * talks to `bench serve`. No sim source and no hidden constants.
 */
export function createWorkspace(
  dir: string,
  opts: { model: string; serviceUrl: string; tracks: string[]; token?: string; budget?: number },
): { dir: string; token: string } {
  const abs = resolve(dir);
  if (existsSync(abs) && readdirSync(abs).length) throw new Error(`workspace dir not empty: ${abs}`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(opts.model)) throw new Error(`bad model slug '${opts.model}'`);
  const root = repoRoot();
  const ddk = join(root, "ddk");
  if (!opts.tracks.length) throw new Error("workspace needs at least one practice track");
  for (const t of opts.tracks)
    if (!existsSync(join(root, "tracks", `${t}.json`))) throw new Error(`unknown track '${t}'`);
  mkdirSync(join(abs, "tracks"), { recursive: true });
  for (const f of WORKSPACE_FILES) copyFileSync(join(ddk, f), join(abs, f));
  const task = readFileSync(join(ddk, "PROMPT_AGENTIC.md"), "utf8");
  writeFileSync(
    join(abs, "TASK.md"),
    task.replace("{{PRACTICE_TRACKS}}", opts.tracks.map((t) => `\`${t}\``).join(", ")),
  );
  copyFileSync(join(ddk, "bench-client.mjs"), join(abs, "bench.mjs"));
  copyFileSync(join(ddk, "baseline-driver.js"), join(abs, "driver.js"));
  for (const t of opts.tracks)
    copyFileSync(join(root, "tracks", `${t}.json`), join(abs, "tracks", `${t}.json`));
  const token = registerToken(opts.model, opts.budget ?? DEFAULT_PRACTICE_BUDGET, opts.token, opts.tracks);
  writeFileSync(
    join(abs, ".bench.json"),
    `${JSON.stringify({ serviceUrl: opts.serviceUrl, token, tracks: opts.tracks }, null, 2)}\n`,
  );
  return { dir: abs, token };
}
