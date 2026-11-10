import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  buildOptions,
  cliCmd,
  clock,
  fillPrompt,
  hhmm,
  isCleanTested,
  lastCleanRun,
  outcomeOf,
  parseActivity,
  parseUsage,
  planBuilds,
  promptVersion,
  readRuns,
  sandboxArgs,
  tokens,
  unwrapShell,
} from "../src/build/lib.js";

describe("buildOptions", () => {
  it("applies defaults and options", () => {
    const o = buildOptions("gp-2", { jobs: "2", only: "codex,claude-haiku-5-5", "dry-run": true }, "m.json");
    expect(o).toMatchObject({ name: "gp-2", jobs: 2, only: ["codex", "claude-haiku-5-5"], dryRun: true });
    expect(o).toMatchObject({ timeout: 30, models: "m.json", port: 8787 });
    expect(buildOptions("x", { "practice-tracks": "a,b", budget: "3" }, "m")).toMatchObject({
      practice: ["a", "b"],
      budget: 3,
    });
  });
  it("rejects bad input", () => {
    expect(() => buildOptions(undefined, {}, "m")).toThrow(/missing <name>/);
    expect(() => buildOptions("Bad_Name", {}, "m")).toThrow(/lowercase/);
    expect(() => buildOptions("x", { timeout: "0" }, "m")).toThrow(/number/);
  });
});

describe("sandbox and CLI command lines", () => {
  it("hides the repo, the other workspaces and the session histories", () => {
    const home = mkdtempSync(join(tmpdir(), "home-"));
    for (const d of ["Codes", ".claude/projects", ".codex/sessions"])
      mkdirSync(join(home, d), { recursive: true });
    writeFileSync(join(home, ".claude.json"), "{}");
    writeFileSync(join(home, ".claude/CLAUDE.md"), "secret");
    const a = sandboxArgs("/ws/m", "/repo", home).join(" ");
    expect(a).toMatch(/^--ro-bind \/ \/ /);
    expect(a).toContain("--tmpfs /repo");
    expect(a).toContain(`--tmpfs ${home}/Codes`);
    expect(a).toContain(`--bind ${home}/.claude ${home}/.claude`);
    expect(a).toContain(`--bind ${home}/.claude.json ${home}/.claude.json`);
    expect(a).toContain(`--tmpfs ${home}/.claude/projects`);
    expect(a).toContain(`--ro-bind /dev/null ${home}/.claude/CLAUDE.md`);
    expect(a).toMatch(/--bind \/ws\/m \/tmp\/ws --chdir \/tmp\/ws$/);
    expect(a).not.toContain(".gemini");
  });
  it("runs each provider's CLI unattended with the model and effort", () => {
    const claude = cliCmd("claude", "claude-x", "high", "P");
    expect(claude.slice(0, 7)).toEqual(["claude", "-p", "P", "--model", "claude-x", "--effort", "high"]);
    expect(claude).toContain("stream-json");
    expect(cliCmd("codex", "gpt-x", "low", "P")).toContain('model_reasoning_effort="low"');
    expect(cliCmd("gemini", "g", "medium", "P")).toEqual([
      "gemini",
      "-p",
      "P",
      "-m",
      "g",
      "--output-format",
      "json",
      "--yolo",
    ]);
  });
});

describe("prompt and formatting", () => {
  it("fills the launch prompt and reads the brief's version", () => {
    expect(fillPrompt("{{TIME_LIMIT}} min, until {{DEADLINE}}", 30, "14:05")).toBe("30 min, until 14:05");
    expect(promptVersion("<!-- prompt version: agentic-0.4 -->")).toBe("agentic-0.4");
    expect(promptVersion("none")).toBe("");
    expect(hhmm(new Date(2026, 0, 1, 9, 5).getTime())).toBe("09:05");
    expect(clock(125.9)).toBe("2:05");
    expect([tokens(null), tokens(999), tokens(12_345), tokens(2_500_000)]).toEqual([
      "–",
      "999",
      "12k",
      "2.5M",
    ]);
  });
});

describe("planBuilds", () => {
  const models = {
    effort: "medium",
    providers: {
      anthropic: { label: "Anthropic", cli: "claude", body: "clay" },
      openai: { label: "OpenAI", cli: "codex", body: "silver" },
    },
    models: [
      { id: "claude-a", name: "A", code: "AAA", provider: "anthropic", color: "blush" },
      { id: "claude-b", name: "B", code: "BBB", provider: "anthropic", color: "lime", effort: "high" },
      { id: "gpt-x", name: "X", code: "XXX", provider: "openai", color: "sky" },
    ],
  };
  it("filters, resolves effort and skips missing CLIs", () => {
    const { plan, skipped } = planBuilds(models, { only: [], effort: undefined }, (c) => c !== "codex");
    expect(plan.map((e) => [e.id, e.cli, e.provider, e.effort])).toEqual([
      ["claude-a", "claude", "anthropic", "medium"],
      ["claude-b", "claude", "anthropic", "high"],
    ]);
    expect(skipped).toEqual(["gpt-x (codex not installed)"]);
    const forced = planBuilds(models, { only: ["claude-b"], effort: "low" }, () => true);
    expect(forced.plan.map((e) => e.effort)).toEqual(["low"]);
  });
  it("picks models by provider, CLI or id", () => {
    const ids = (only: string[]) =>
      planBuilds(models, { only, effort: undefined }, () => true).plan.map((e) => e.id);
    expect(ids(["openai"])).toEqual(["gpt-x"]);
    expect(ids(["codex"])).toEqual(["gpt-x"]);
    expect(ids(["anthropic", "gpt-x"])).toEqual(["claude-a", "claude-b", "gpt-x"]);
  });
  it("rejects an invalid roster, unknown CLIs and efforts", () => {
    const none = { only: [], effort: undefined };
    expect(() => planBuilds({ claude: [{ id: "g" }] }, none, () => true)).toThrow(/models.json/);
    const grok = {
      ...models,
      providers: { ...models.providers, openai: { label: "x", cli: "grok", body: "pearl" } },
    };
    expect(() => planBuilds(grok, none, () => true)).toThrow(/unknown cli 'grok'/);
    expect(() => planBuilds(models, { only: [], effort: "turbo" }, () => true)).toThrow(/effort/);
    const bad = { ...models, models: [{ ...models.models[0]!, effort: "turbo" }] };
    expect(() => planBuilds(bad, none, () => true)).toThrow(/claude-a: unknown effort/);
  });
  it("reads the repo's models.json", () => {
    const real = JSON.parse(readFileSync(join(import.meta.dirname, "../../../models.json"), "utf8"));
    expect(planBuilds(real, { only: [], effort: undefined }, () => true).plan.length).toBeGreaterThan(0);
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
    const tab = { type: "assistant", message: { content: [{ type: "text", text: "a\tb\r\u001b[31mc" }] } };
    expect(parseActivity("claude", JSON.stringify(tab))).toEqual([{ text: "a b [31mc", tool: false }]);
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
      const result = { status, offTracks, strikes: 0, lapTime: 90.5 };
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
      entry: {
        cli: "codex",
        provider: "openai",
        id: "gpt-x",
        name: "GPT X",
        effort: "medium",
        slug: "gpt-x",
      },
      opts: { practice: ["monaco"], timeout: 30 },
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
    expect(m).toMatchObject({
      provider: "openai",
      settings: { cli: "codex", effort: "medium", cliError: null, turns: 1 },
    });
  });
});
