import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { readSiteConfig, scanResults } from "./server/results-index.js";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(here, "../../results");
const tracksDir = resolve(here, "../../tracks");
const siteConfig = resolve(here, "../../site.json");

/**
 * Serves `results/` at `/results/` for `vite` and `vite preview`, so local replays load by URL, and
 * `/results/index.json`, rebuilt on every request (with `site.json`), listing the replays found there.
 */
function serveResults(): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    if (!url.startsWith("/results/")) return next();
    if (url === "/results/index.json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-cache");
      res.end(JSON.stringify(scanResults(resultsDir, tracksDir, readSiteConfig(siteConfig))));
      return;
    }
    const file = normalize(join(resultsDir, decodeURIComponent(url.slice("/results/".length))));
    if (!file.startsWith(resultsDir) || !existsSync(file) || !statSync(file).isFile()) return next();
    res.setHeader("Content-Type", file.endsWith(".gz") ? "application/gzip" : "application/json");
    res.setHeader("Cache-Control", "no-cache");
    createReadStream(file).pipe(res);
  };
  return {
    name: "serve-results",
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

/** Adds the Umami tracker to every page when `UMAMI_WEBSITE_ID` is set, which only the deploy does. */
function analytics(): Plugin {
  const id = process.env.UMAMI_WEBSITE_ID;
  return {
    name: "analytics",
    transformIndexHtml: () =>
      id
        ? [
            {
              tag: "script",
              attrs: { defer: true, src: "https://stats.crty.dev/script.js", "data-website-id": id },
              injectTo: "head",
            },
          ]
        : [],
  };
}

export default defineConfig({
  plugins: [react(), serveResults(), analytics()],
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        // Libraries change far less often than the app: in their own chunks a deploy leaves them cached.
        codeSplitting: {
          groups: [
            {
              name: "three",
              test: /node_modules[\\/](three|three-stdlib|@react-three|maath|troika-|camera-controls)/,
            },
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
});
