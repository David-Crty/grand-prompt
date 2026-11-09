import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  isCleanTested,
  lastCleanRun,
  outcomeOf,
  parseActivity,
  parseArgs,
  parseUsage,
  planBuilds,
  readRuns,
  UsageError,
  unwrapShell,
} from "./lib.js";

describe("parseArgs", () => {
  it("applies defaults and options", () => {
    const o = parseArgs(["gp-2", "--jobs", "2", "--only", "codex,claude-haiku-5-5", "--dry-run"], "m.json");
    expect(o).toMatchObject({ name: "gp-2", jobs: 2, only: ["codex", "claude-haiku-5-5"], dryRun: true });
    expect(o).toMatchObject({ eventTrack: "barcelona", timeout: 30, models: "m.json" });
  });
  it("rejects bad input", () => {
    expect(() => parseArgs([], "m")).toThrow(UsageError);
    expect(() => parseArgs(["Bad_Name"], "m")).toThrow(/lowercase/);
    expect(() => parseArgs(["x", "--timeout", "0"], "m")).toThrow(/number/);
    expect(() => parseArgs(["x", "--event-track", "monaco"], "m")).toThrow(/practice track/);
    expect(() => parseArgs(["x", "--wat"], "m")).toThrow(/unknown option/);
    expect(parseArgs(["--help"], "m")).toBe("help");
  });
});

describe("planBuilds", () => {
  const models = {
    effort: "medium",
    claude: [
      { id: "claude-a", name: "A" },
      { id: "claude-b", effort: "high" },
    ],
    codex: [{ id: "gpt-x" }],
    gemini: [],
  };
  it("filters, resolves effort and skips missing CLIs", () => {
    const { plan, skipped } = planBuilds(models, { only: [], effort: undefined }, (c) => c !== "codex");
    expect(plan.map((e) => [e.id, e.effort])).toEqual([
      ["claude-a", "medium"],
      ["claude-b", "high"],
    ]);
    expect(skipped).toEqual(["gpt-x (codex not installed)"]);
    const forced = planBuilds(models, { only: ["claude-b"], effort: "low" }, () => true);
    expect(forced.plan.map((e) => e.effort)).toEqual(["low"]);
  });
  it("rejects unknown providers and efforts", () => {
    expect(() => planBuilds({ grok: [{ id: "g" }] }, { only: [], effort: undefined }, () => true)).toThrow();
    expect(() => planBuilds(models, { only: [], effort: "turbo" }, () => true)).toThrow(/effort/);
  });
});

describe("parseUsage", () => {
  it("reads Claude's stream and plain json", () => {
    const result = {
      type: "result",
      usage: { input_tokens: 1, cache_read_input_tokens: 10, output_tokens: 5 },
      total_cost_usd: 0.5,
      num_turns: 3,
    };
    const stream = `${JSON.stringify({ type: "system" })}\n${JSON.stringify(result)}\n`;
    expect(parseUsage("claude", stream)).toEqual({
      inputTokens: 11,
      outputTokens: 5,
      costUsd: 0.5,
      turns: 3,
      error: null,
    });
    const { type: _, ...plain } = result;
    expect(parseUsage("claude", JSON.stringify({ ...plain, is_error: true })).error).toBe("error");
    expect(parseUsage("claude", "garbage").inputTokens).toBeNull();
  });
  it("sums Codex turns", () => {
    const lines = [
      { type: "turn.completed", usage: { input_tokens: 4, output_tokens: 2 } },
      { type: "turn.completed", usage: {} },
    ];
    const u = parseUsage("codex", lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(u).toMatchObject({ inputTokens: 4, outputTokens: 2, turns: 2 });
  });
  it("reads Gemini stats", () => {
    const g = { stats: { models: { a: { tokens: { prompt: 3, candidates: 1 } } } } };
    expect(parseUsage("gemini", JSON.stringify(g))).toMatchObject({ inputTokens: 3, outputTokens: 1 });
  });
});

describe("parseActivity", () => {
  it("describes Claude tool calls and text", () => {
    const e = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "\nLet me look.\nmore" },
          { type: "tool_use", name: "Read", input: { file_path: "/tmp/ws/TASK.md" } },
          { type: "tool_use", name: "Bash", input: { command: "node bench.mjs status" } },
        ],
      },
    };
    expect(parseActivity("claude", JSON.stringify(e))).toEqual([
      { text: "Let me look.", tool: false },
      { text: "Read TASK.md", tool: true },
      { text: "$ node bench.mjs status", tool: true },
    ]);
    expect(parseActivity("claude", "{")).toEqual([]);
  });
  it("describes Codex commands, messages and edits", () => {
    const cmd = {
      type: "item.started",
      item: { type: "command_execution", command: "/usr/bin/zsh -lc 'cat TASK.md'" },
    };
    expect(parseActivity("codex", JSON.stringify(cmd))).toEqual([{ text: "$ cat TASK.md", tool: true }]);
    const msg = { type: "item.completed", item: { type: "agent_message", text: "Done." } };
    expect(parseActivity("codex", JSON.stringify(msg))).toEqual([{ text: "Done.", tool: false }]);
    const edit = {
      type: "item.completed",
      item: { type: "file_change", changes: [{ path: "/tmp/ws/driver.js" }] },
    };
    expect(parseActivity("codex", JSON.stringify(edit))).toEqual([{ text: "edit driver.js", tool: true }]);
    expect(unwrapShell("bash -lc 'echo '\\''hi'\\'''")).toBe("echo 'hi'");
  });
});

describe("practice runs", () => {
  it("finds the newest clean run and matches drivers to it", () => {
    const ws = mkdtempSync(join(tmpdir(), "build-drivers-test-"));
    const run = (n: string, status: string, offTracks: number, driver: string) => {
      mkdirSync(join(ws, "runs", n), { recursive: true });
      writeFileSync(join(ws, "runs", n, "driver.js"), driver);
      const result = { status, offTracks, strikes: 0, bestLap: 90.5 };
      writeFileSync(join(ws, "runs", n, "summary.json"), JSON.stringify({ track: "monaco", result }));
    };
    run("001", "FINISHED", 0, "a");
    run("002", "FINISHED", 0, "b");
    run("003", "CRASHED", 0, "c");
    run("004", "FINISHED", 2, "d");
    mkdirSync(join(ws, "runs", "005"));
    expect(readRuns(ws).map((r) => r.clean)).toEqual([true, true, false, false]);
    expect(lastCleanRun(ws)).toBe("002");
    writeFileSync(join(ws, "driver.js"), "a");
    expect(isCleanTested(ws, join(ws, "driver.js"))).toBe(true);
    writeFileSync(join(ws, "driver.js"), "c");
    expect(isCleanTested(ws, join(ws, "driver.js"))).toBe(false);
    expect(readRuns(join(ws, "nope"))).toEqual([]);
  });
});

describe("outcome and manifest", () => {
  it("names the outcome like the shell script did", () => {
    const sig = { SIGTERM: 15 };
    expect(outcomeOf({ code: 0, signal: null, timedOut: false }, sig)).toBe("ok");
    expect(outcomeOf({ code: null, signal: "SIGTERM", timedOut: true }, sig)).toBe("timeout");
    expect(outcomeOf({ code: 2, signal: null, timedOut: false }, sig)).toBe("cli exit 2");
    expect(outcomeOf({ code: null, signal: "SIGTERM", timedOut: false }, sig)).toBe("cli exit 143");
  });
  it("drops missing usage fields but keeps settings nulls", () => {
    const m = buildManifest({
      entry: { provider: "codex", id: "gpt-x", name: "GPT X", effort: "medium", slug: "gpt-x" },
      opts: { practice: ["monaco"], eventTrack: "barcelona", timeout: 30 },
      promptVersion: "p",
      ddkVersion: "d",
      simVersion: "s",
      outcome: "ok",
      source: "driver.js",
      runs: null,
      wallTimeS: 12,
      usage: { inputTokens: 5, outputTokens: null, costUsd: null, turns: 1, error: null },
    });
    expect(m.usage).toEqual({ inputTokens: 5, wallTimeS: 12 });
    expect(m).toMatchObject({ provider: "openai", settings: { effort: "medium", cliError: null, turns: 1 } });
  });
});
