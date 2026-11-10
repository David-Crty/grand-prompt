import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { loadDriverSource, readJson, repoRoot, writeJson } from "./load.js";
import { practiceWith, validate } from "./session.js";

/**
 * Practice service for agentic builds. It runs outside the model's workspace, so a model practises without
 * seeing the sim source or the hidden car constants, and it counts the runs against each token's budget.
 */
export interface TokenRecord {
  /** The event being built: practice runs go to `results/agentic/<event>/<model>/`. */
  event: string;
  model: string;
  budget: number;
  used: number;
  created: string;
  /** The circuits this token may practise on; the first is the default. */
  tracks: string[];
  runs: { at: string; track: string; lapTime: number | null; status: string; driverHash: string }[];
}

/** One file for every token: rewritten on each registration, so never register concurrently. */
export function tokenStorePath(): string {
  return join(repoRoot(), "results", "agentic", "tokens.json");
}

export function readTokens(): Record<string, TokenRecord> {
  const p = tokenStorePath();
  return existsSync(p) ? readJson<Record<string, TokenRecord>>(p) : {};
}

function writeTokens(t: Record<string, TokenRecord>): void {
  writeJson(tokenStorePath(), t);
}

export function registerToken(event: string, model: string, budget: number, tracks: string[]): string {
  const t = readTokens();
  const token = randomBytes(12).toString("hex");
  t[token] = { event, model, budget, used: 0, created: new Date().toISOString(), tracks, runs: [] };
  writeTokens(t);
  return token;
}

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

class HttpError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `GET /status?token=`, `POST /validate` (free) and `POST /practice` (counts one run), each POST with
 * `{token, source, filename?, track?}`. Requests are served one at a time: practice is CPU-bound.
 */
export async function serve(opts: { port: number; host?: string }): Promise<{
  url: string;
  server: Server;
  close: () => Promise<void>;
}> {
  const host = opts.host ?? "127.0.0.1";
  const tokenRecord = (token: unknown) => {
    const rec = readTokens()[String(token ?? "")];
    if (!rec) throw new HttpError(403, "unknown token");
    return rec;
  };

  const handle = async (req: IncomingMessage): Promise<unknown> => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/status") {
      const rec = tokenRecord(url.searchParams.get("token"));
      return {
        model: rec.model,
        used: rec.used,
        budget: rec.budget,
        left: rec.budget - rec.used,
        tracks: rec.tracks,
      };
    }
    if (req.method !== "POST" || (url.pathname !== "/practice" && url.pathname !== "/validate"))
      throw new HttpError(404, "not found");
    const b = await body(req);
    const rec = tokenRecord(b.token);
    const source = String(b.source ?? "");
    const filename = String(b.filename ?? "driver.js").endsWith(".ts") ? "driver.ts" : "driver.js";
    const track = b.track === undefined ? rec.tracks[0]! : String(b.track);
    if (!rec.tracks.includes(track))
      throw new HttpError(
        403,
        `track '${track}' is not a practice circuit (available: ${rec.tracks.join(", ")})`,
      );
    const dir = join(repoRoot(), "results", "agentic", rec.event, rec.model);

    if (url.pathname === "/validate") {
      mkdirSync(join(dir, "validate"), { recursive: true });
      const file = join(dir, "validate", filename);
      writeFileSync(file, source);
      const r = await validate(file, { track });
      return { ok: r.ok, text: r.text };
    }

    if (rec.used >= rec.budget) throw new HttpError(429, `practice budget exhausted (${rec.budget} runs)`);
    const tokens = readTokens();
    const used = ++tokens[String(b.token)]!.used;
    writeTokens(tokens);
    const left = rec.budget - used;
    let d: Awaited<ReturnType<typeof loadDriverSource>>;
    try {
      d = await loadDriverSource(source, filename, rec.model, { logging: true });
    } catch (e) {
      return { ok: false, text: `load failed: ${(e as Error).message}\n`, used, left };
    }
    const out = join(dir, `practice-${String(used).padStart(3, "0")}`);
    const r = await practiceWith(d, filename, { track, out });
    const c = r.results!.classification[0]!;
    const fresh = readTokens();
    fresh[String(b.token)]!.runs.push({
      at: new Date().toISOString(),
      track,
      lapTime: c.lapTime,
      status: c.status,
      driverHash: d.hash,
    });
    writeTokens(fresh);
    const files = Object.fromEntries(
      ["summary.txt", "summary.json", "telemetry.csv", "log.txt"].map((n) => [
        n,
        readFileSync(join(out, n), "utf8"),
      ]),
    );
    return { ok: true, text: r.text.replace(/\nfiles: .*\n/, "\n"), files, used, left };
  };

  let queue = Promise.resolve();
  const server = createServer((req, res) => {
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    queue = queue.then(() =>
      handle(req).then(
        (data) => send(200, data),
        (e: Error) => send(e instanceof HttpError ? e.code : 400, { error: e.message }),
      ),
    );
  });
  await new Promise<void>((r) => server.listen(opts.port, host, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : opts.port;
  return {
    url: `http://${host}:${port}`,
    server,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
