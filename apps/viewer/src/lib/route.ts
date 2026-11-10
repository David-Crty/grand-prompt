/**
 * The site's pages by path: `/` (or `/races`) the race list, `/drivers` the drivers, `/races/<track>/<event>` one
 * race's replay, whose files are in `results/races/<track>/<event>/`, and `/races/<track>/<event>/results` its
 * results. The lists take the event they show from `?event=`; viewer options stay in the query too
 * (`?t=30&cam=tv`).
 */
export type Route =
  | { page: "races"; event?: string }
  | { page: "drivers"; event?: string }
  | { page: "race"; track: string; event: string }
  | { page: "result"; track: string; event: string };

/** The race list's data, built from `results/` (by the dev server, or once for the site). */
export const INDEX_URL = "/results/index.json";

const segment = (raw: string): string | null => {
  try {
    const s = decodeURIComponent(raw);
    return s && s !== "." && s !== ".." && !s.includes("/") ? s : null;
  } catch {
    return null;
  }
};

export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean);
  const event = new URLSearchParams(search).get("event") || undefined;
  const list = (page: "races" | "drivers"): Route => (event ? { page, event } : { page });
  if (parts[0] === "drivers" && parts.length === 1) return list("drivers");
  if (parts[0] === "races" && (parts.length === 3 || (parts.length === 4 && parts[3] === "results"))) {
    const track = segment(parts[1]!);
    const ev = segment(parts[2]!);
    if (track && ev) return { page: parts.length === 4 ? "result" : "race", track, event: ev };
  }
  return list("races");
}

export function routeHref(r: Route): string {
  if (r.page === "race" || r.page === "result") {
    const race = `/races/${encodeURIComponent(r.track)}/${encodeURIComponent(r.event)}`;
    return r.page === "result" ? `${race}/results` : race;
  }
  const query = r.event ? `?event=${encodeURIComponent(r.event)}` : "";
  return (r.page === "drivers" ? "/drivers" : "/") + query;
}

/** Where a race's files are published: `replay.json.gz`, `results.json`, `event-results.json`. */
export function raceFileUrl(track: string, event: string, file: string): string {
  return `/results/races/${encodeURIComponent(track)}/${encodeURIComponent(event)}/${file}`;
}

export function raceReplayUrl(track: string, event: string): string {
  return raceFileUrl(track, event, "replay.json.gz");
}

/** The project's source, linked from the site so visitors can star it. */
export const REPO_URL = "https://github.com/David-Crty/llm-racing";

/** A model's driver program on GitHub, as entered in an event. */
export function driverSourceUrl(event: string, id: string): string {
  return `${REPO_URL}/blob/main/drivers/${encodeURIComponent(event)}/${encodeURIComponent(id)}/driver.js`;
}

/** Who made it. */
export const AUTHOR_URL = "https://crty.dev";
