import { COLORS, colorSlot, ENTRY_COLORS, SLOT_COUNT } from "@bench/ui";
import { describe, expect, it } from "vitest";
import { eventEntries, ROSTER } from "../src/lib/entries.js";
import { buildModel } from "../src/lib/model.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();
const replay = makeReplay(
  [makeCar(track, { id: "gpt-b", speed: 50 }), makeCar(track, { id: "claude-a", speed: 45 })],
  track,
);

const owned = new Set(ROSTER.models.map((m) => colorSlot(m.color)));
const free = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).filter((s) => !owned.has(s));

describe("event entries", () => {
  it("give cars off the roster the colours no roster model owns, in id order, whatever the replay order", () => {
    const e = eventEntries(replay.cars);
    expect(free.length).toBeGreaterThan(0);
    expect(e.get("claude-a")?.slot).toBe(free[0]);
    expect(e.get("gpt-b")?.slot).toBe(free[1] ?? 0);
    expect(e.get("claude-a")).toMatchObject({ provider: "other", body: COLORS["body-graphite"] });
  });

  it("are the model's colours", () => {
    const m = buildModel(replay, 10);
    expect([m.entries.get("claude-a")?.code, m.entries.get("gpt-b")?.code]).toEqual(["CA1", "CA2"]);
    expect(m.entries.get("claude-a")?.color).toBe(ENTRY_COLORS[free[0]! - 1]);
    expect(m.entries.get("gpt-b")?.color).toBe(free[1] ? ENTRY_COLORS[free[1] - 1] : COLORS["entry-none"]);
  });

  it("take a roster model's identity from models.json, whoever else races", () => {
    const alone = eventEntries([{ id: "gpt-6-luna", name: "whatever the replay says" }]).get("gpt-6-luna");
    const field = eventEntries(ROSTER.models.map((m) => ({ id: m.id, name: m.name }))).get("gpt-6-luna");
    expect(alone).toEqual(field);
    expect(alone).toMatchObject({
      name: "GPT-6 Luna",
      code: "LUN",
      provider: "openai",
      providerLabel: "OpenAI",
      body: COLORS["body-silver"],
    });
  });
});
