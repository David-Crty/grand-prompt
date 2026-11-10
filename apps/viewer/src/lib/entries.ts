import { type Entry, entryMap, parseRoster, rosterEntries } from "@bench/ui";
import models from "../../../../models.json";

export const ROSTER = parseRoster(models);

/**
 * Entries of one event: roster models as `models.json` gives them, other cars in id order, so the race list
 * and the viewer give a car the same code and colour.
 */
export function eventEntries(items: { id: string; name: string }[]): Map<string, Entry> {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return entryMap(rosterEntries(sorted, ROSTER));
}
