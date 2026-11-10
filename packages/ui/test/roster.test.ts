import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BODY_NAMES, colorSlot, parseRoster, rosterEntries } from "../src/roster.js";
import { COLORS, ENTRY_COLOR_NAMES, ENTRY_COLORS } from "../src/tokens.gen.js";

const models = JSON.parse(readFileSync(join(import.meta.dirname, "../../../models.json"), "utf8"));

const base = () => ({
  effort: "medium",
  providers: {
    anthropic: { label: "Anthropic", cli: "claude", body: "clay" },
    openai: { label: "OpenAI", cli: "codex", body: "silver" },
  },
  models: [
    { id: "claude-a", name: "Claude A", code: "AAA", provider: "anthropic", color: "cobalt" },
    {
      id: "gpt-b",
      name: "GPT B",
      code: "BBB",
      provider: "openai",
      color: "blush",
      body: "pearl",
      effort: "high",
    },
  ] as Record<string, unknown>[],
});

const withModel = (r: ReturnType<typeof base>, i: number, patch: Record<string, unknown>) => ({
  ...r,
  models: r.models.map((m, k) => (k === i ? { ...m, ...patch } : m)),
});

describe("models.json", () => {
  it("is a valid roster", () => {
    const r = parseRoster(models);
    expect(r.models.length).toBeGreaterThan(0);
    expect(new Set(r.models.map((m) => m.color)).size).toBe(r.models.length);
  });
});

describe("parseRoster", () => {
  it("keeps every field", () => {
    const r = parseRoster(base());
    expect(r.effort).toBe("medium");
    expect(r.providers.openai).toEqual({ label: "OpenAI", cli: "codex", body: "silver" });
    expect(r.models[1]).toMatchObject({ body: "pearl", effort: "high" });
    const { effort: _, ...noEffort } = base();
    expect(parseRoster(noEffort).effort).toBeUndefined();
  });

  const broken: [string, (r: ReturnType<typeof base>) => unknown, RegExp][] = [
    ["not an object", () => [], /not an object/],
    ["a numeric effort", (r) => ({ ...r, effort: 3 }), /effort is a string/],
    ["no providers", (r) => ({ ...r, providers: [] }), /providers is an object/],
    ["no model list", (r) => ({ ...r, models: {} }), /models is a list/],
    ["a provider that is not an object", (r) => ({ ...r, providers: { x: "y" } }), /provider x is an object/],
    [
      "a provider without a cli",
      (r) => ({ ...r, providers: { x: { label: "X", body: "clay" } } }),
      /provider x: missing cli/,
    ],
    [
      "an unknown body",
      (r) => ({ ...r, providers: { x: { label: "X", cli: "x", body: "gold" } } }),
      /unknown body 'gold'/,
    ],
    ["a model that is not an object", (r) => ({ ...r, models: [1] }), /model 1 is an object/],
    ["a model without an id", (r) => ({ ...r, models: [{ name: "x" }] }), /model 1: missing id/],
    ["a long code", (r) => withModel(r, 0, { code: "ABCD" }), /code 'ABCD'/],
    ["an unknown provider", (r) => withModel(r, 0, { provider: "xai" }), /unknown provider 'xai'/],
    ["an unknown colour", (r) => withModel(r, 0, { color: "teal" }), /unknown color 'teal'/],
    ["a model body that is not a token", (r) => withModel(r, 0, { body: "gold" }), /claude-a: unknown body/],
    ["a numeric model effort", (r) => withModel(r, 0, { effort: 2 }), /claude-a: effort is a string/],
    [
      "a shared colour",
      (r) => withModel(r, 1, { color: "cobalt" }),
      /gpt-b: color 'cobalt' is already taken/,
    ],
    ["a shared code", (r) => withModel(r, 1, { code: "AAA" }), /gpt-b: code 'AAA' is already taken/],
    ["a repeated id", (r) => withModel(r, 1, { id: "claude-a" }), /id 'claude-a' is already taken/],
  ];
  it.each(broken)("rejects %s", (_, edit, msg) => {
    expect(() => parseRoster(edit(base()))).toThrow(msg);
  });
});

describe("rosterEntries", () => {
  const roster = parseRoster(base());

  it("gives roster models their code, colour, provider and body, matched by id", () => {
    const [a, b] = rosterEntries(
      [
        { id: "claude-a", name: "from the replay" },
        { id: "gpt-b", name: "GPT B" },
      ],
      roster,
    );
    expect(a).toMatchObject({
      name: "Claude A",
      code: "AAA",
      slot: colorSlot("cobalt"),
      color: ENTRY_COLORS[colorSlot("cobalt") - 1],
      provider: "anthropic",
      providerLabel: "Anthropic",
      body: COLORS["body-clay"],
    });
    expect(b).toMatchObject({ slot: 1, body: COLORS["body-pearl"] });
  });

  it("keeps the roster's colours free when those models are not racing", () => {
    const [x] = rosterEntries([{ id: "baseline", name: "DDK baseline" }], roster);
    expect(x).toMatchObject({ code: "DDK", slot: 3, provider: "other" });
  });

  it("names colours as the tokens do", () => {
    expect(ENTRY_COLOR_NAMES).toHaveLength(ENTRY_COLORS.length);
    expect(colorSlot("blush")).toBe(1);
    expect(colorSlot("teal")).toBe(0);
    expect(BODY_NAMES).toContain("graphite");
  });
});
