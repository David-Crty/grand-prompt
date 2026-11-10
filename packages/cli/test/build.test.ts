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
    const o = buildOptions(
      "r2-medium",
      { jobs: "2", only: "codex,claude-haiku-5-5", "dry-run": true },
      "m.json",
    );
    expect(o).toMatchObject({
      name: "r2-medium",
      jobs: 2,
      only: ["codex", "claude-haiku-5-5"],
      dryRun: true,
    });
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
    for (const d of [".gemini/antigravity-cli", ".gemini/config"])
      mkdirSync(join(home, d), { recursive: true });
    const g = sandboxArgs("/ws/m", "/repo", home).join(" ");
    expect(g).toContain(`--bind ${home}/.gemini ${home}/.gemini`);
    expect(g).toContain(`--tmpfs ${home}/.gemini/antigravity-cli`);
    expect(g).toContain(`--tmpfs ${home}/.gemini/config`);
  });
  it("runs each provider's CLI unattended with the model and effort", () => {
    const claude = cliCmd("claude", "claude-x", "high", "P");
    expect(claude.slice(0, 7)).toEqual(["claude", "-p", "P", "--model", "claude-x", "--effort", "high"]);
    expect(claude).toContain("stream-json");
    expect(cliCmd("codex", "gpt-x", "low", "P")).toContain('model_reasoning_effort="low"');
    const agy = cliCmd("agy", "gemini-x", "medium", "P");
    expect(agy.slice(0, 7)).toEqual(["agy", "-p", "P", "--model", "gemini-x", "--effort", "medium"]);
    expect(agy).toContain("--dangerously-skip-permissions");
    const settings = JSON.parse(agy[agy.indexOf("--settings") + 1]!);
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining(["read_url(*)", "execute_url(*)", "mcp(*)"]),
    );
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
    providers: {
      anthropic: { label: "Anthropic", cli: "claude", body: "clay" },
      openai: { label: "OpenAI", cli: "codex", body: "silver" },
    },
    models: [
      { id: "claude-a", name: "A", code: "AAA", provider: "anthropic", color: "blush" },
      { id: "claude-b", name: "B", code: "BBB", provider: "anthropic", color: "lime" },
      { id: "gpt-x", name: "X", code: "XXX", provider: "openai", color: "sky" },
    ],
  };
  it("filters, resolves effort and skips missing CLIs", () => {
    const { plan, skipped } = planBuilds(models, { only: [], effort: undefined }, (c) => c !== "codex");
    expect(plan.map((e) => [e.id, e.cli, e.provider, e.effort])).toEqual([
      ["claude-a", "claude", "anthropic", "medium"],
      ["claude-b", "claude", "anthropic", "medium"],
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
    expect(() => planBuilds(models, { only: [], effort: "turbo" }, () => true)).toThrow(/unknown effort/);
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
      usage: {
        input_tokens: 1,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 2,
        output_tokens: 5,
      },
      total_cost_usd: 0.5,
      num_turns: 3,
    };
    const stream = `${JSON.stringify({ type: "system" })}\n${JSON.stringify(result)}\n`;
    expect(parseUsage("claude", stream)).toEqual({
      inputTokens: 13,
      cachedInputTokens: 10,
      cacheWriteTokens: 2,
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
      {
        type: "turn.completed",
        usage: {
          input_tokens: 10,
          cached_input_tokens: 7,
          cache_write_input_tokens: 1,
          output_tokens: 4,
          reasoning_output_tokens: 3,
        },
      },
      { type: "turn.completed", usage: {} },
    ];
    const u = parseUsage("codex", lines.map((l) => JSON.stringify(l)).join("\n"));
    expect(u).toMatchObject({
      inputTokens: 10,
      cachedInputTokens: 7,
      cacheWriteTokens: 1,
      outputTokens: 4,
      costUsd: null,
      turns: 2,
    });
  });
  it("reads agy's result, adding cache reads to the input", () => {
    const usage = {
      input_tokens: 15,
      output_tokens: 7,
      thinking_tokens: 3,
      cache_read_tokens: 20,
      total_tokens: 22,
    };
    const step = { event: "step_update", step_update: { step_type: "agent_response", usage } };
    const result = { event: "result", result: { status: "SUCCESS", num_turns: 1, usage } };
    expect(parseUsage("agy", [step, result].map((l) => JSON.stringify(l)).join("\n"))).toEqual({
      inputTokens: 35,
      cachedInputTokens: 20,
      cacheWriteTokens: null,
      outputTokens: 7,
      costUsd: null,
      turns: 1,
      error: null,
    });
    const failed = { event: "result", result: { status: "ERROR", error: "auth required", usage: {} } };
    expect(parseUsage("agy", JSON.stringify(failed))).toMatchObject({
      inputTokens: null,
      error: "auth required",
    });
    expect(parseUsage("agy", JSON.stringify(step)).inputTokens).toBeNull();
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
  it("describes agy tool calls as they start", () => {
    const tool = (state: string, tool_name: string, parameters: object) =>
      JSON.stringify({
        event: "step_update",
        step_update: { step_type: "tool", state, tool_name, tool_info: { parameters } },
      });
    expect(
      parseActivity("agy", tool("ACTIVE", "run_command", { CommandLine: "node bench.mjs status" })),
    ).toEqual([{ text: "$ node bench.mjs status", tool: true }]);
    expect(
      parseActivity(
        "agy",
        tool("ACTIVE", "write_to_file", { TargetFile: "/tmp/ws/driver.js", Overwrite: true }),
      ),
    ).toEqual([{ text: "write_to_file driver.js", tool: true }]);
    expect(parseActivity("agy", tool("ACTIVE", "list_dir", { Recursive: true }))).toEqual([
      { text: "list_dir", tool: true },
    ]);
    expect(parseActivity("agy", tool("DONE", "run_command", { CommandLine: "ls" }))).toEqual([]);
    expect(parseActivity("agy", JSON.stringify({ event: "result", result: {} }))).toEqual([]);
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
      driverDevelopmentKitVersion: "d",
      simVersion: "s",
      outcome: "ok",
      source: "driver.js",
      runs: null,
      wallTimeS: 12,
      usage: {
        inputTokens: 5,
        cachedInputTokens: 3,
        cacheWriteTokens: null,
        outputTokens: null,
        costUsd: null,
        turns: 1,
        error: null,
      },
    });
    expect(m.usage).toEqual({ inputTokens: 5, cachedInputTokens: 3, wallTimeS: 12 });
    expect(m).toMatchObject({
      provider: "openai",
      settings: { cli: "codex", effort: "medium", cliError: null, turns: 1 },
    });
  });
});
