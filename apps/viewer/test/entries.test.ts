import { ENTRY_COLORS } from "@bench/ui";
import { describe, expect, it } from "vitest";
import { eventEntries, recolorRace, recolorReplay } from "../src/lib/entries.js";
import { buildModel } from "../src/lib/model.js";
import { paramsForReplay, parseParams } from "../src/lib/params.js";
import { summarizeRace } from "../src/lib/races.js";
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

  it("recolours cars and classification without touching the source", () => {
    const e = eventEntries(replay.cars);
    const out = recolorReplay(replay, e);
    expect(out.cars.find((c) => c.id === "claude-a")?.color).toBe(ENTRY_COLORS[0]);
    const withRows = recolorReplay(
      {
        ...replay,
        classification: replay.cars.map((c) => ({
          ...c.result,
          id: c.id,
          name: c.name,
          position: 1,
          gap: null,
          color: c.color,
          driverHash: c.driverHash,
        })),
      },
      e,
    );
    expect(withRows.classification.find((c) => c.id === "gpt-b")?.color).toBe(ENTRY_COLORS[1]);
    expect(replay.cars[0]!.color).not.toBe(out.cars[0]!.color);
    const unknown = recolorReplay(replay, new Map());
    expect(unknown.cars[0]!.color).toBe(replay.cars[0]!.color);
  });

  it("is applied by the model and the race list alike", () => {
    const m = buildModel(replay, 10);
    expect([m.entries.get("claude-a")?.code, m.entries.get("gpt-b")?.code]).toEqual(["CA1", "CA2"]);
    expect(m.replay.cars.find((c) => c.id === "gpt-b")?.color).toBe(ENTRY_COLORS[1]);
    const src = {
      simVersion: "0.1.0",
      trackId: "stadium",
      session: { seed: 1 },
    };
    const cls = replay.cars.map((c, i) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      status: "FINISHED" as const,
      position: i + 1,
      lapTime: 60 + i,
    }));
    const row = recolorRace(summarizeRace("e/race", "/r.json", { ...src, classification: cls }, { time: 0 }));
    expect(row.drivers.find((d) => d.id === "gpt-b")?.color).toBe(m.entries.get("gpt-b")?.color);
    expect(row.pole?.color).toBe(m.entries.get(row.pole!.id)?.color);
    expect(recolorRace({ ...row, pole: null }).pole).toBeNull();
  });
});

describe("deep links", () => {
  const p = parseParams("?replay=/r.json&t=48&cam=map&car=x");
  it("apply to the replay named in the URL", () => {
    expect(paramsForReplay(p, true)).toMatchObject({ t: 48, cam: "map", car: "x" });
  });
  it("reset for a dropped replay", () => {
    expect(paramsForReplay(p, false)).toMatchObject({ t: null, cam: null, car: null, replay: "/r.json" });
  });
});
