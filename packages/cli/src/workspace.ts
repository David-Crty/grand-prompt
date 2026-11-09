import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { repoRoot } from "./load.js";
import { registerToken } from "./service.js";

export const WORKSPACE_FILES = ["DRIVER_SPEC.md", "driver.d.ts", "baseline-driver.js", "car-public.json"];

/**
 * An isolated workspace for an agentic run: the DDK, a starting driver and a practice client that
 * talks to `bench serve`. No sim source and no hidden constants.
 */
export function createWorkspace(
  dir: string,
  opts: { model: string; serviceUrl: string; track: string; token?: string; budget?: number },
): { dir: string; token: string } {
  const abs = resolve(dir);
  if (existsSync(abs) && readdirSync(abs).length) throw new Error(`workspace dir not empty: ${abs}`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(opts.model)) throw new Error(`bad model slug '${opts.model}'`);
  const root = repoRoot();
  const ddk = join(root, "ddk");
  mkdirSync(join(abs, "tracks"), { recursive: true });
  for (const f of WORKSPACE_FILES) copyFileSync(join(ddk, f), join(abs, f));
  copyFileSync(join(ddk, "PROMPT_AGENTIC.md"), join(abs, "TASK.md"));
  copyFileSync(join(ddk, "bench-client.mjs"), join(abs, "bench.mjs"));
  copyFileSync(join(ddk, "baseline-driver.js"), join(abs, "driver.js"));
  copyFileSync(join(root, "tracks", `${opts.track}.json`), join(abs, "tracks", `${opts.track}.json`));
  const token = registerToken(opts.model, opts.budget ?? 20, opts.token);
  writeFileSync(
    join(abs, ".bench.json"),
    `${JSON.stringify({ serviceUrl: opts.serviceUrl, token, track: opts.track }, null, 2)}\n`,
  );
  return { dir: abs, token };
}
