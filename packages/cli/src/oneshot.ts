import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DDK_VERSION, SIM_VERSION } from "@bench/sim";
import { type EventConfig, eventPaths, type Manifest, validate } from "./commands.js";
import { loadTrack, readJson, repoRoot } from "./load.js";

export const ONESHOT_PROMPT_VERSION = "oneshot-0.2";

/** Fill PROMPT_ONESHOT.md with the DDK contents. */
export function buildOneshotPrompt(ev: EventConfig): string {
  const ddk = join(repoRoot(), "ddk");
  const read = (f: string) => readFileSync(join(ddk, f), "utf8").trim();
  const track = loadTrack(ev.track);
  const fill: Record<string, string> = {
    TRACK_NAME: track.name,
    TRACK_LENGTH: track.length.toFixed(0),
    DRIVER_SPEC: read("DRIVER_SPEC.md"),
    DRIVER_DTS: read("driver.d.ts"),
    CAR_PUBLIC: read("car-public.json"),
    BASELINE: read("baseline-driver.js"),
  };
  return read("PROMPT_ONESHOT.md")
    .replace(/^<!--.*?-->\n/s, "")
    .replace(/\{\{(\w+)\}\}/g, (m, k: string) => fill[k] ?? m);
}

/** Extract the driver module from a model reply: the largest fenced js/ts block (or any block). */
export function extractCode(reply: string): string | null {
  const blocks = [...reply.matchAll(/```([a-zA-Z]*)\n([\s\S]*?)```/g)];
  if (!blocks.length) return null;
  const pref = blocks.filter((b) => /^(js|javascript|ts|typescript|mjs)$/i.test(b[1]!));
  const pool = pref.length ? pref : blocks;
  return pool.reduce((a, b) => (b[2]!.length > a[2]!.length ? b : a))[2]!.trimEnd() + "\n";
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export type ChatFn = (
  model: string,
  messages: ChatMessage[],
  settings: Record<string, unknown>,
) => Promise<ChatResult>;

/** OpenRouter chat completions (one gateway for every provider, with cost accounting). */
export const openRouterChat: ChatFn = async (model, messages, settings) => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set (run under `op run`)");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, usage: { include: true }, ...settings }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  if (!res.ok || data.error) throw new Error(`OpenRouter: ${data.error?.message ?? res.status}`);
  return {
    content: data.choices?.[0]?.message.content ?? "",
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
    costUsd: data.usage?.cost,
  };
};

export interface OneshotOptions {
  event: string;
  model: string;
  slug: string;
  settings?: Record<string, unknown>;
  chat?: ChatFn;
}

/**
 * One-shot protocol: one prompt, one reply. If the module fails to load (syntax, missing export),
 * one fix round with the loader's error. Writes the driver, manifest and transcript.
 */
export async function runOneshot(
  o: OneshotOptions,
): Promise<{ manifest: Manifest; driverPath: string; text: string }> {
  const chat = o.chat ?? openRouterChat;
  const p = eventPaths(o.event);
  const ev = readJson<EventConfig>(p.config);
  const settings = o.settings ?? {};
  const messages: ChatMessage[] = [{ role: "user", content: buildOneshotPrompt(ev) }];
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, wallTimeS: 0 };
  const t0 = Date.now();
  const ask = async () => {
    const r = await chat(o.model, messages, settings);
    usage.inputTokens += r.inputTokens ?? 0;
    usage.outputTokens += r.outputTokens ?? 0;
    usage.costUsd += r.costUsd ?? 0;
    messages.push({ role: "assistant", content: r.content });
    return r.content;
  };
  const driverDir = join(p.drivers, o.slug);
  const driverPath = join(driverDir, "driver.js");
  mkdirSync(driverDir, { recursive: true });
  const lines: string[] = [];
  let code = extractCode(await ask());
  writeFileSync(driverPath, code ?? "// no code block in the reply\n");
  let v = await validate(driverPath, { track: ev.track, infoLevel: ev.infoLevel });
  const loadFailed = (text: string) => /FAIL (load|init)/.test(text) || code === null;
  if (loadFailed(v.text)) {
    lines.push("first attempt failed to load; one fix round allowed");
    messages.push({
      role: "user",
      content: `Your module failed to load:\n\n${code === null ? "No fenced code block found in your reply." : v.text}\nReply with the corrected full module in one fenced js code block.`,
    });
    code = extractCode(await ask()) ?? code;
    writeFileSync(driverPath, code ?? "// no code block in the reply\n");
    v = await validate(driverPath, { track: ev.track, infoLevel: ev.infoLevel });
  }
  usage.wallTimeS = (Date.now() - t0) / 1000;
  lines.push(v.text.trim());
  const resDir = join(p.results, o.slug);
  mkdirSync(resDir, { recursive: true });
  writeFileSync(join(resDir, "transcript.json"), `${JSON.stringify(messages, null, 2)}\n`);
  const manifest: Manifest = {
    model: o.model,
    provider: "openrouter",
    mode: "one-shot",
    settings,
    promptVersion: ONESHOT_PROMPT_VERSION,
    ddkVersion: DDK_VERSION,
    simVersion: SIM_VERSION,
    usage,
    transcript: "transcript.json",
  };
  writeFileSync(join(resDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, driverPath, text: `${lines.join("\n")}\n` };
}
