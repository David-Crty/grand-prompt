import { ENTRY_COLORS } from "@bench/ui";
import { describe, expect, it } from "vitest";
import { eventEntries } from "../src/lib/entries.js";
import { buildModel } from "../src/lib/model.js";
import { paramsForReplay, parseParams } from "../src/lib/params.js";
import { makeCar, makeReplay, stadiumTrack } from "./fixtures.js";

const track = stadiumTrack();
const replay = makeReplay(
  [makeCar(track, { id: "gpt-b", speed: 50 }), makeCar(track, { id: "claude-a", speed: 45 })],
  track,
);

describe("event entries", () => {
  it("assigns slots in id order, whatever the replay order", () => {
    const e = eventEntries(replay.cars);
    expect(e.get("claude-a")?.slot).toBe(1);
    expect(e.get("gpt-b")?.slot).toBe(2);
    expect(e.get("claude-a")?.provider).toBe("anthropic");
  });

  it("are the model's colours", () => {
    const m = buildModel(replay, 10);
    expect([m.entries.get("claude-a")?.code, m.entries.get("gpt-b")?.code]).toEqual(["CA1", "CA2"]);
    expect(m.entries.get("gpt-b")?.color).toBe(ENTRY_COLORS[1]);
  });
});

describe("deep links", () => {
  const p = parseParams("?t=48&cam=map&car=x");
  it("apply to the race named in the URL", () => {
    expect(paramsForReplay(p, true)).toMatchObject({ t: 48, cam: "map", car: "x" });
  });
  it("reset for a dropped replay", () => {
    expect(paramsForReplay(p, false)).toMatchObject({ t: null, cam: null, car: null, speed: null });
  });
});
