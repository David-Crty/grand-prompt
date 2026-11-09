import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { practiceWith, validate } from "./commands.js";
import { loadDriverSource, repoRoot } from "./load.js";

/**
 * Practice service for agentic runs. It lives outside the agent's workspace, so the agent can
 * practice without seeing the sim source or hidden constants. It also counts practice runs.
 */
export interface TokenRecord {
  model: string;
  budget: number;
  used: number;
  created: string;
  /** Circuits this token may practise on; the first is the default. Absent: any circuit. */
  tracks?: string[];
  runs: {
    at: string;
    track?: string;
    laps: number;
    bestLap: number | null;
    status: string;
    driverHash: string;
  }[];
}

export function tokenStorePath(): string {
  return join(repoRoot(), "results", "agentic", "tokens.json");
}

export function readTokens(): Record<string, TokenRecord> {
  const p = tokenStorePath();
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, TokenRecord>) : {};
}

function writeTokens(t: Record<string, TokenRecord>): void {
  const p = tokenStorePath();
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, `${JSON.stringify(t, null, 2)}\n`);
}

export function registerToken(model: string, budget: number, token?: string, tracks?: string[]): string {
  const t = readTokens();
  const tok = token ?? randomBytes(12).toString("hex");
  t[tok] = {
    model,
    budget,
    used: 0,
    created: new Date().toISOString(),
    ...(tracks ? { tracks } : {}),
    runs: [],
  };
  writeTokens(t);
  return tok;
}

const MAX_LAPS = 5;
const MAX_BODY = 2 * 1024 * 1024;

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("request too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
}

export async function serve(opts: { port: number; host?: string }): Promise<{
  url: string;
  server: Server;
  close: () => Promise<void>;
}> {
  let queue = Promise.resolve();
  const server = createServer((req, res) => {
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const handle = async () => {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/status") {
        const rec = readTokens()[url.searchParams.get("token") ?? ""];
        if (!rec) return send(403, { error: "unknown token" });
        return send(200, {
          model: rec.model,
          used: rec.used,
          budget: rec.budget,
          left: rec.budget - rec.used,
          ...(rec.tracks ? { tracks: rec.tracks } : {}),
        });
      }
      if (req.method !== "POST" || (url.pathname !== "/practice" && url.pathname !== "/validate"))
        return send(404, { error: "not found" });
      const b = await body(req);
      const tokens = readTokens();
      const rec = tokens[String(b.token ?? "")];
      if (!rec) return send(403, { error: "unknown token" });
      const source = String(b.source ?? "");
      const filename = String(b.filename ?? "driver.js").endsWith(".ts") ? "driver.ts" : "driver.js";
      let track = typeof b.track === "string" && /^[a-z0-9-]+$/.test(b.track) ? b.track : "proto-ring";
      if (rec.tracks) {
        track = b.track === undefined ? rec.tracks[0]! : String(b.track);
        if (!rec.tracks.includes(track))
          return send(403, {
            error: `track '${track}' is not a practice circuit (available: ${rec.tracks.join(", ")})`,
          });
      }
      if (url.pathname === "/validate") {
        // Validation is free: it does not count against the practice budget.
        const dir = join(repoRoot(), "results", "agentic", rec.model, "validate");
        mkdirSync(dir, { recursive: true });
        const file = join(dir, filename);
        writeFileSync(file, source);
        const r = await validate(file, { track });
        return send(200, { ok: r.ok, text: r.text });
      }
      if (rec.used >= rec.budget)
        return send(429, { error: `practice budget exhausted (${rec.budget} runs)` });
      const laps = Math.max(1, Math.min(MAX_LAPS, Number(b.laps ?? 3) || 3));
      rec.used++;
      writeTokens(tokens);
      let d: Awaited<ReturnType<typeof loadDriverSource>>;
      try {
        d = await loadDriverSource(source, filename, rec.model, { logging: true });
      } catch (e) {
        return send(200, {
          ok: false,
          text: `load failed: ${(e as Error).message}\n`,
          used: rec.used,
          left: rec.budget - rec.used,
        });
      }
      const out = join(
        repoRoot(),
        "results",
        "agentic",
        rec.model,
        `practice-${String(rec.used).padStart(3, "0")}`,
      );
      const r = await practiceWith(d, filename, { track, laps, out });
      const c = r.results!.classification[0]!;
      const fresh = readTokens();
      fresh[String(b.token)]!.runs.push({
        at: new Date().toISOString(),
        track,
        laps,
        bestLap: c.bestLap,
        status: c.status,
        driverHash: d.hash,
      });
      writeTokens(fresh);
      const read = (n: string) => readFileSync(join(out, n), "utf8");
      return send(200, {
        ok: true,
        text: r.text.replace(/\nfiles: .*\n/, "\n"),
        files: {
          "summary.txt": read("summary.txt"),
          "summary.json": read("summary.json"),
          "telemetry.csv": read("telemetry.csv"),
          "log.txt": read("log.txt"),
        },
        used: rec.used,
        left: rec.budget - rec.used,
      });
    };
    // Serialize runs: practice is CPU-bound and the token file is shared.
    queue = queue.then(() =>
      handle().catch((e: Error) => {
        if (!res.headersSent) send(400, { error: e.message });
      }),
    );
  });
  await new Promise<void>((r) => server.listen(opts.port, opts.host ?? "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  return {
    url: `http://${opts.host ?? "127.0.0.1"}:${port}`,
    server,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
