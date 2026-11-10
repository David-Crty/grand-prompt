/**
 * The site's pages by path: `/` (or `/races`) the race list, `/drivers` the drivers, `/races/<id>` one race,
 * whose files are in `results/races/<id>/`. Viewer options stay in the query (`?t=30&cam=tv`).
 */
export type Route = { page: "races" } | { page: "drivers" } | { page: "race"; id: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "drivers" && parts.length === 1) return { page: "drivers" };
  if (parts[0] === "races" && parts.length === 2) {
    try {
      const id = decodeURIComponent(parts[1]!);
      if (id && id !== "." && id !== "..") return { page: "race", id };
    } catch {
      // A malformed escape is not a race id.
    }
  }
  return { page: "races" };
}

export function routeHref(r: Route): string {
  if (r.page === "drivers") return "/drivers";
  if (r.page === "race") return `/races/${encodeURIComponent(r.id)}`;
  return "/";
}

/** Where a race's replay is published. */
export function raceReplayUrl(id: string): string {
  return `/results/races/${encodeURIComponent(id)}/replay.json.gz`;
}

/** The project's source, linked from the site so visitors can star it. */
export const REPO_URL = "https://github.com/David-Crty/llm-racing";

/** Who made it. */
export const AUTHOR_URL = "https://crty.dev";
