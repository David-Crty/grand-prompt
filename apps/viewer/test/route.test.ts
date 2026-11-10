import { describe, expect, it } from "vitest";
import { driverSourceUrl, parseRoute, raceFileUrl, raceReplayUrl, routeHref } from "../src/lib/route.js";

describe("routes", () => {
  it("reads the page from the path", () => {
    expect(parseRoute("/")).toEqual({ page: "races" });
    expect(parseRoute("/races")).toEqual({ page: "races" });
    expect(parseRoute("/races/")).toEqual({ page: "races" });
    expect(parseRoute("/drivers")).toEqual({ page: "drivers" });
    expect(parseRoute("/drivers/")).toEqual({ page: "drivers" });
    expect(parseRoute("/races/monaco/r1-medium")).toEqual({
      page: "race",
      track: "monaco",
      event: "r1-medium",
    });
    expect(parseRoute("/races/my%20ring/my%20event/")).toEqual({
      page: "race",
      track: "my ring",
      event: "my event",
    });
    expect(parseRoute("/nope")).toEqual({ page: "races" });
    expect(parseRoute("/races/monaco")).toEqual({ page: "races" });
    expect(parseRoute("/races/a/b/c")).toEqual({ page: "races" });
    expect(parseRoute("/races/monaco/%E0%A4%A")).toEqual({ page: "races" });
    expect(parseRoute("/races/../r1")).toEqual({ page: "races" });
    expect(parseRoute("/races/monaco/.")).toEqual({ page: "races" });
    expect(parseRoute("/races/a%2Fb/r1")).toEqual({ page: "races" });
    expect(parseRoute("/races/monaco/r1-medium/results")).toEqual({
      page: "result",
      track: "monaco",
      event: "r1-medium",
    });
    expect(parseRoute("/races/monaco/r1-medium/nope")).toEqual({ page: "races" });
  });

  it("reads the lists' event from the query", () => {
    expect(parseRoute("/", "?event=r1-high")).toEqual({ page: "races", event: "r1-high" });
    expect(parseRoute("/drivers", "?t=3&event=r1-high")).toEqual({ page: "drivers", event: "r1-high" });
    expect(parseRoute("/drivers", "?event=")).toEqual({ page: "drivers" });
    expect(parseRoute("/races/x/r1-medium", "?event=r1-high")).toEqual({
      page: "race",
      track: "x",
      event: "r1-medium",
    });
    expect(routeHref({ page: "races", event: "r1 high" })).toBe("/?event=r1%20high");
    expect(routeHref({ page: "drivers", event: "r1-high" })).toBe("/drivers?event=r1-high");
    expect(
      parseRoute("/drivers", routeHref({ page: "drivers", event: "a&b" }).slice("/drivers".length)),
    ).toEqual({
      page: "drivers",
      event: "a&b",
    });
  });

  it("links each page and a race's replay", () => {
    expect(routeHref({ page: "races" })).toBe("/");
    expect(routeHref({ page: "drivers" })).toBe("/drivers");
    const race = { page: "race", track: "my ring", event: "r1 high" } as const;
    expect(routeHref(race)).toBe("/races/my%20ring/r1%20high");
    expect(parseRoute(routeHref(race))).toEqual(race);
    expect(raceReplayUrl("monaco", "r1 high")).toBe("/results/races/monaco/r1%20high/replay.json.gz");
    const result = { page: "result", track: "my ring", event: "r1 high" } as const;
    expect(routeHref(result)).toBe("/races/my%20ring/r1%20high/results");
    expect(parseRoute(routeHref(result))).toEqual(result);
    expect(raceFileUrl("monaco", "r1", "results.json")).toBe("/results/races/monaco/r1/results.json");
    expect(driverSourceUrl("r1-medium", "claude-fable-5-1")).toBe(
      "https://github.com/David-Crty/llm-racing/blob/main/drivers/r1-medium/claude-fable-5-1/driver.js",
    );
  });
});
