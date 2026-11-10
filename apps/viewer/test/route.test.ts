import { describe, expect, it } from "vitest";
import { driverSourceUrl, parseRoute, raceReplayUrl, routeHref } from "../src/lib/route.js";

describe("routes", () => {
  it("reads the page from the path", () => {
    expect(parseRoute("/")).toEqual({ page: "races" });
    expect(parseRoute("/races")).toEqual({ page: "races" });
    expect(parseRoute("/races/")).toEqual({ page: "races" });
    expect(parseRoute("/drivers")).toEqual({ page: "drivers" });
    expect(parseRoute("/drivers/")).toEqual({ page: "drivers" });
    expect(parseRoute("/races/r1-medium")).toEqual({ page: "race", id: "r1-medium" });
    expect(parseRoute("/races/my%20race/")).toEqual({ page: "race", id: "my race" });
    expect(parseRoute("/nope")).toEqual({ page: "races" });
    expect(parseRoute("/races/a/b")).toEqual({ page: "races" });
    expect(parseRoute("/races/%E0%A4%A")).toEqual({ page: "races" });
    expect(parseRoute("/races/..")).toEqual({ page: "races" });
  });

  it("links each page and a race's replay", () => {
    expect(routeHref({ page: "races" })).toBe("/");
    expect(routeHref({ page: "drivers" })).toBe("/drivers");
    expect(routeHref({ page: "race", id: "my race" })).toBe("/races/my%20race");
    expect(parseRoute(routeHref({ page: "race", id: "a/b" }))).toEqual({ page: "race", id: "a/b" });
    expect(raceReplayUrl("a/b")).toBe("/results/races/a%2Fb/replay.json.gz");
    expect(driverSourceUrl("r1-medium", "claude-fable-5-1")).toBe(
      "https://github.com/David-Crty/llm-racing/blob/main/drivers/r1-medium/claude-fable-5-1/driver.js",
    );
  });
});
