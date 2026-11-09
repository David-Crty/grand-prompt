#!/usr/bin/env node
// Practice client for agentic workspaces. Talks to `bench serve`; reads .bench.json for URL and token.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const cfg = JSON.parse(readFileSync(new URL("./.bench.json", import.meta.url), "utf8"));
const [cmd, file = "driver.js", ...rest] = process.argv.slice(2);
const lapsIdx = rest.indexOf("--laps");
const laps = lapsIdx >= 0 ? Number(rest[lapsIdx + 1]) : 3;

async function post(path, body) {
  const res = await fetch(cfg.serviceUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: cfg.token, track: cfg.track, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

try {
  if (cmd === "status") {
    const res = await fetch(`${cfg.serviceUrl}/status?token=${cfg.token}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    console.log(`practice runs used ${d.used} of ${d.budget} (${d.left} left)`);
  } else if (cmd === "validate" || cmd === "practice") {
    const source = readFileSync(file, "utf8");
    const d = await post(`/${cmd}`, { source, filename: file, laps });
    process.stdout.write(d.text);
    if (cmd === "practice") {
      if (d.files) {
        const base = new URL("./runs/", import.meta.url).pathname;
        mkdirSync(base, { recursive: true });
        const n = readdirSync(base).length + 1;
        const dir = join(base, String(n).padStart(3, "0"));
        mkdirSync(dir);
        writeFileSync(join(dir, "driver.js"), source);
        for (const [name, content] of Object.entries(d.files)) writeFileSync(join(dir, name), content);
        console.log(
          `files: runs/${String(n).padStart(3, "0")}/{summary.txt,summary.json,telemetry.csv,log.txt}`,
        );
      }
      console.log(`practice runs left: ${d.left}`);
    }
    if (d.ok === false) process.exitCode = 2;
  } else {
    console.log("usage: node bench.mjs validate|practice <driver.js> [--laps N] | status");
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
}
