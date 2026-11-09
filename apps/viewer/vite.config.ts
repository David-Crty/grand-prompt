import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = resolve(here, "../../results");

/** Serves `results/` at `/results/` for `vite` and `vite preview`, so local replays load by URL. */
function serveResults(): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    if (!url.startsWith("/results/")) return next();
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

export default defineConfig({
  plugins: [react(), serveResults()],
  build: { chunkSizeWarningLimit: 2000 },
});
