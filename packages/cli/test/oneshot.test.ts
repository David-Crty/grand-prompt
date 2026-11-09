import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildOneshotPrompt,
  type ChatFn,
  extractCode,
  openRouterChat,
  run,
  runOneshot,
} from "../src/index.js";

const repo = new URL("../../../", import.meta.url).pathname;
let root: string;
let prev: string | undefined;
const ev = {
  id: "os",
  name: "OS",
  track: "proto-ring",
  seed: 1,
  infoLevel: "B" as const,
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "oneshot-"));
  for (const d of ["tracks", "cars", "ddk"]) cpSync(join(repo, d), join(root, d), { recursive: true });
  mkdirSync(join(root, "results/os"), { recursive: true });
  writeFileSync(join(root, "results/os/event.json"), JSON.stringify(ev));
  prev = process.env.BENCH_ROOT;
  process.env.BENCH_ROOT = root;
});
afterAll(() => {
  if (prev === undefined) delete process.env.BENCH_ROOT;
  else process.env.BENCH_ROOT = prev;
});

const baseline = readFileSync(join(repo, "ddk/baseline-driver.js"), "utf8");

describe("one-shot protocol", () => {
  it("builds the prompt from the DDK with every placeholder filled", () => {
    const p = buildOneshotPrompt(ev);
    expect(p).not.toMatch(/\{\{\w+\}\}/);
    expect(p).not.toMatch(/<!--/);
    expect(p).toMatch(/Prototype Ring/);
    expect(p).toMatch(/one flying lap/);
    expect(p).toMatch(/export declare function step/);
    expect(p).toMatch(/LATERAL_ACCEL/);
  });

  it("extracts the largest js block, or any block", () => {
    expect(extractCode("no code")).toBeNull();
    expect(extractCode("```js\na\n```\ntext\n```javascript\nlonger\n```")).toBe("longer\n");
    expect(extractCode("```json\n{}\n```\n```ts\nx\n```")).toBe("x\n");
    expect(extractCode("```\nplain\n```")).toBe("plain\n");
  });

  it("submits, validates, and writes manifest and transcript", async () => {
    const calls: number[] = [];
    const chat: ChatFn = async (_m, messages) => {
      calls.push(messages.length);
      return {
        content: `Approach: baseline.\n\`\`\`js\n${baseline}\`\`\``,
        inputTokens: 4000,
        outputTokens: 900,
        costUsd: 0.01,
      };
    };
    const r = await runOneshot({
      event: "os",
      model: "acme/m1",
      slug: "m1",
      chat,
      settings: { temperature: 0 },
    });
    expect(calls).toEqual([1]);
    expect(r.text).toMatch(/PASS/);
    expect(readFileSync(r.driverPath, "utf8")).toBe(baseline.trimEnd() + "\n");
    const m = JSON.parse(readFileSync(join(root, "results/os/m1/manifest.json"), "utf8"));
    expect(m).toMatchObject({
      model: "acme/m1",
      mode: "one-shot",
      usage: { inputTokens: 4000, outputTokens: 900 },
    });
    expect(existsSync(join(root, "results/os/m1/transcript.json"))).toBe(true);
  });

  it("allows exactly one fix round after a load failure", async () => {
    const replies = [
      "I think this works: ```js\nexport function step( {\n```",
      `\`\`\`js\n${baseline}\`\`\``,
    ];
    const seen: string[] = [];
    const chat: ChatFn = async (_m, messages) => {
      seen.push(messages.at(-1)!.content);
      return { content: replies.shift()! };
    };
    const r = await runOneshot({ event: "os", model: "acme/m2", slug: "m2", chat });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(/failed to load/);
    expect(r.text).toMatch(/one fix round/);
    expect(r.text).toMatch(/PASS/);
  });

  it("handles a reply with no code at all, twice", async () => {
    const chat: ChatFn = async () => ({ content: "Sorry, I can't." });
    const r = await runOneshot({ event: "os", model: "acme/m3", slug: "m3", chat });
    expect(r.text).toMatch(/FAIL/);
    expect(readFileSync(r.driverPath, "utf8")).toMatch(/no code block/);
  });

  it("the CLI prints the prompt, and the OpenRouter client needs a key", async () => {
    let out = "";
    await run(["oneshot", "os", "--prompt-only"], (s) => {
      out += s;
    });
    expect(out).toMatch(/Your task/);
    await expect(run(["oneshot", "os"], () => {})).rejects.toThrow(/--model/);
    const key = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    await expect(openRouterChat("x", [], {})).rejects.toThrow(/OPENROUTER_API_KEY/);
    await expect(run(["oneshot", "os", "--model", "acme/x"], () => {})).rejects.toThrow(/OPENROUTER_API_KEY/);
    if (key !== undefined) process.env.OPENROUTER_API_KEY = key;
  });

  it("parses OpenRouter responses (mocked fetch)", async () => {
    const key = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "hello" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const r = await openRouterChat("acme/m", [{ role: "user", content: "hi" }], { temperature: 0 });
      expect(r).toEqual({ content: "hello", inputTokens: 10, outputTokens: 5, costUsd: 0.002 });
      const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
      expect(body).toMatchObject({ model: "acme/m", temperature: 0, usage: { include: true } });
      fetchMock.mockImplementationOnce(async () =>
        Response.json({ error: { message: "nope" } }, { status: 400 }),
      );
      await expect(openRouterChat("acme/m", [], {})).rejects.toThrow(/OpenRouter: nope/);
      fetchMock.mockImplementationOnce(async () => Response.json({}, { status: 500 }));
      await expect(openRouterChat("acme/m", [], {})).rejects.toThrow(/OpenRouter: 500/);
      fetchMock.mockImplementationOnce(async () => Response.json({}));
      expect((await openRouterChat("acme/m", [], {})).content).toBe("");
    } finally {
      vi.unstubAllGlobals();
      if (key === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = key;
    }
  });
});
