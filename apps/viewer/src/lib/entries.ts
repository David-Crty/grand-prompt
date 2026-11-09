import { type Entry, entryMap, resolveEntries } from "@bench/ui";

/**
 * Entries of one event, resolved in id order, so the race list and the viewer give a car the same code
 * and colour slot.
 */
export function eventEntries(items: { id: string; name: string }[]): Map<string, Entry> {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return entryMap(resolveEntries(sorted.map((c) => ({ id: c.id, name: c.name }))));
}
