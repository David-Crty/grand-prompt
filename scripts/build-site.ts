/**
 * Assembles the static site: the built viewer, the published result files under `results/races/`, the race
 * list the dev server otherwise builds per request (with `site.json`'s default event, which must have races),
 * and the Cloudflare Pages headers. The site has no 404.html, so Pages answers `/races/<track>/<event>` and
 * `/drivers` with index.html and the viewer routes them.
 *
 *   pnpm --filter @bench/viewer build && tsx scripts/build-site.ts [outDir]   (default site/)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSiteConfig, scanResults } from "../apps/viewer/server/results-index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const viewerDist = join(root, "apps/viewer/dist");
const resultsDir = join(root, "results");
const out = resolve(process.argv[2] ?? join(root, "site"));

/** What the viewer reads, from results/races/ only; practice, builds and tokens stay private. */
const PUBLISHED = new Set([
  "replay.json",
  "replay.json.gz",
  "results.json",
  "event-results.json",
  "summary.txt",
]);

const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/results/*
  Cache-Control: public, max-age=300
`;

function copyPublished(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) n += copyPublished(p);
    else if (PUBLISHED.has(name)) {
      const dest = join(out, "results", relative(resultsDir, p));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(p, dest);
      n++;
    }
  }
  return n;
}

if (!existsSync(join(viewerDist, "index.html"))) {
  console.error("apps/viewer/dist is missing: run `pnpm --filter @bench/viewer build` first");
  process.exit(1);
}
if (!existsSync(resultsDir)) {
  console.error("results/ is missing: run `pnpm bench event run <event>` first");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
cpSync(viewerDist, out, { recursive: true });
const files = existsSync(join(resultsDir, "races")) ? copyPublished(join(resultsDir, "races")) : 0;
const index = scanResults(resultsDir, join(root, "tracks"), readSiteConfig(join(root, "site.json")));
if (index.defaultEvent && !index.events.includes(index.defaultEvent)) {
  console.error(`site.json: defaultEvent '${index.defaultEvent}' has no races (${index.events.join(", ")})`);
  process.exit(1);
}
writeFileSync(join(out, "results/index.json"), JSON.stringify(index));
writeFileSync(join(out, "_headers"), HEADERS);
console.log(
  `${relative(root, out) || out}: ${index.races.length} races in ${index.events.length} events, ${files} result files`,
);
