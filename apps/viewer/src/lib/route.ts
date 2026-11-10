/**
 * The site's pages by path: `/` (or `/races`) the race list, `/drivers` the drivers, `/races/<id>` one race,
 * whose files are in `results/races/<id>/`. The lists take the event they show from `?event=`; viewer options
 * stay in the query too (`?t=30&cam=tv`).
 */
export type Route =
  | { page: "races"; event?: string }
  | { page: "drivers"; event?: string }
  | { page: "race"; id: string };

export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean);
  const event = new URLSearchParams(search).get("event") || undefined;
  const list = (page: "races" | "drivers"): Route => (event ? { page, event } : { page });
  if (parts[0] === "drivers" && parts.length === 1) return list("drivers");
  if (parts[0] === "races" && parts.length === 2) {
    try {
      const id = decodeURIComponent(parts[1]!);
      if (id && id !== "." && id !== "..") return { page: "race", id };
    } catch {
      // A malformed escape is not a race id.
    }
  }
  return list("races");
}

export function routeHref(r: Route): string {
  if (r.page === "race") return `/races/${encodeURIComponent(r.id)}`;
  const query = r.event ? `?event=${encodeURIComponent(r.event)}` : "";
  return (r.page === "drivers" ? "/drivers" : "/") + query;
}

/** Where a race's replay is published. */
export function raceReplayUrl(id: string): string {
  return `/results/races/${encodeURIComponent(id)}/replay.json.gz`;
}

/** The project's source, linked from the site so visitors can star it. */
export const REPO_URL = "https://github.com/David-Crty/llm-racing";

/** A model's driver program on GitHub, as entered in an event. */
export function driverSourceUrl(event: string, id: string): string {
  return `${REPO_URL}/blob/main/drivers/${encodeURIComponent(event)}/${encodeURIComponent(id)}/driver.js`;
}

/** Who made it. */
export const AUTHOR_URL = "https://crty.dev";
