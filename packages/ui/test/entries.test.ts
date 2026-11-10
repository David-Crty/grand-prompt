import { describe, expect, it } from "vitest";
import { deriveCode, entryMap, resolveEntries, SLOT_COUNT } from "../src/entries.js";
import { COLORS, ENTRY_COLORS } from "../src/tokens.gen.js";

const gp1 = [
  ["claude-opus-5-5", "Claude Opus 5.5"],
  ["claude-fable-5-1", "Claude Fable 5.1"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
  ["claude-haiku-5-5", "Claude Haiku 5.5"],
  ["gpt-6.1-sol", "GPT-6.1 Sol"],
  ["gpt-6.1-terra", "GPT-6.1 Terra"],
  ["gpt-6-astra", "GPT-6 Astra"],
  ["gpt-6-luna", "GPT-6 Luna"],
].map(([id, name]) => ({ id: id!, name: name! }));

describe("deriveCode", () => {
  it("uses the model's given name", () => {
    expect(gp1.map((e) => deriveCode(e.name))).toEqual([
      "OPU",
      "FAB",
      "SON",
      "HAI",
      "SOL",
      "TER",
      "AST",
      "LUN",
    ]);
  });
  it("falls back when no word qualifies", () => {
    expect(deriveCode("DDK (baseline)")).toBe("DDK");
    expect(deriveCode("GPT-5")).toBe("GPT");
    expect(deriveCode("o3")).toBe("OXX");
    expect(deriveCode("123")).toBe("CAR");
  });
});

describe("resolveEntries", () => {
  it("gives entries without explicit identity slots in input order, derived codes and the neutral provider", () => {
    const e = resolveEntries(gp1);
    expect(e.map((x) => x.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(e[1]).toMatchObject({
      code: "FAB",
      provider: "other",
      providerLabel: "Other",
      color: ENTRY_COLORS[1],
      body: COLORS["body-graphite"],
    });
  });

  it("keeps reserved slots free for their owners", () => {
    const e = resolveEntries(
      [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Bravo", slot: 2 },
      ],
      [1, 2, 3],
    );
    expect(e.map((x) => x.slot)).toEqual([4, 2]);
  });

  it("honours explicit free slots, then fills the lowest free ones", () => {
    const e = resolveEntries([
      { id: "a-1", name: "Alpha", slot: 3 },
      { id: "b-1", name: "Bravo", slot: 3 },
      { id: "c-1", name: "Charlie" },
      { id: "d-1", name: "Delta", slot: 99 },
    ]);
    expect(e.map((x) => x.slot)).toEqual([3, 1, 2, 4]);
  });

  it("gives entries past the twelfth slot the neutral colour", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `m-${i}`, name: `Model ${i}` }));
    const e = resolveEntries(many);
    expect(e[11]!.slot).toBe(12);
    expect(e[12]).toMatchObject({ slot: 0, color: COLORS["entry-none"], body: COLORS["body-graphite"] });
  });

  it("splits code collisions with the version digit, or a counter, and keeps explicit codes", () => {
    const e = resolveEntries([
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { id: "claude-sonnet-6", name: "Claude Sonnet 6" },
      { id: "x", name: "Sonnet" },
      { id: "y", name: "Whatever", code: "fab" },
    ]);
    expect(e.map((x) => x.code)).toEqual(["SO5", "SO6", "SO3", "FAB"]);
    const twins = resolveEntries([
      { id: "p", name: "Pilot" },
      { id: "q", name: "Pilot" },
    ]);
    expect(twins.map((x) => x.code)).toEqual(["PI1", "PI2"]);
    const clash = resolveEntries([
      { id: "a", name: "Claude Opus 6" },
      { id: "b", name: "Roster Opus", code: "OPU" },
      { id: "c", name: "Twin", code: "OPU" },
    ]);
    expect(clash.map((x) => x.code)).toEqual(["OP6", "OPU", "OP1"]);
  });

  it("runs out of slots past twelve", () => {
    const many = Array.from({ length: SLOT_COUNT + 2 }, (_, i) => ({ id: `m${i}`, name: `Model ${i}` }));
    const e = resolveEntries(many);
    expect(e.slice(-2).map((x) => x.slot)).toEqual([0, 0]);
    expect(entryMap(e).get("m0")?.slot).toBe(1);
  });
});
