/**
 * Entries: how a car is identified everywhere (tower, labels, trails, map, charts, video). Each entry gets a
 * three-letter code, a colour slot (1 to 12, unique within an event) and a provider, whose body paint the car
 * wears. The roster (`roster.ts`, from `models.json`) supplies all of it for the models it lists; these
 * functions derive the rest. Pure functions, shared by the viewer and the video.
 */
import { COLORS, ENTRY_COLORS } from "./tokens.gen.js";

export interface EntryInput {
  id: string;
  name: string;
  /** Explicit identity, from the roster. */
  code?: string;
  slot?: number;
  provider?: string;
  providerLabel?: string;
  /** Resolved body paint. */
  body?: string;
}

export interface Entry {
  id: string;
  name: string;
  code: string;
  /** 1 to 12, or 0 for an entry past twelve without a free slot. */
  slot: number;
  /** The roster's provider id, or `other`. */
  provider: string;
  providerLabel: string;
  /** Entry colour (chip, label, trail, tower, map, charts, livery stripe). */
  color: string;
  /** 3D body paint. */
  body: string;
}

export const SLOT_COUNT = ENTRY_COLORS.length;

const FAMILY_WORDS = /^(claude|gpt|gemini|gemma|grok|mistral|openai|o\d)$/i;

/**
 * Three-letter code from the model's given name: "Claude Fable 5.1" FAB, "GPT-6 Astra" AST, "GPT-6.1 Sol" SOL.
 * Falls back to the first letters of the name when no word qualifies.
 */
export function deriveCode(name: string): string {
  const words = name
    .split(/[\s_-]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .filter((w) => w.length > 0 && !FAMILY_WORDS.test(w));
  const pick = words.find((w) => w.length >= 3) ?? words.join("");
  const letters = pick || name.replace(/[^A-Za-z]/g, "") || "CAR";
  return letters.slice(0, 3).toUpperCase().padEnd(3, "X");
}

/** First version digit in a name ("Claude Sonnet 5.5" gives "5"), used to split code collisions. */
function versionDigit(name: string): string {
  return name.match(/\d/)?.[0] ?? "";
}

function uniqueCodes(items: EntryInput[]): string[] {
  const used = new Set<string>();
  const claim = (c: string) => {
    let code = c;
    let n = 1;
    while (used.has(code)) code = `${c.slice(0, 2)}${n++}`;
    used.add(code);
    return code;
  };
  const codes = items.map((e) => (e.code ? claim(e.code.toUpperCase()) : ""));
  const derived = items.map((e) => deriveCode(e.name));
  const seen = new Map<string, number>();
  for (const [i, c] of derived.entries()) if (!items[i]!.code) seen.set(c, (seen.get(c) ?? 0) + 1);
  return items.map((e, i) => {
    if (e.code) return codes[i]!;
    const c = derived[i]!;
    const split = (seen.get(c) ?? 0) > 1 || used.has(c);
    return claim(split ? `${c.slice(0, 2)}${versionDigit(e.name) || i + 1}` : c);
  });
}

/**
 * Resolve every entry of one event. Explicit slots are honoured first, in order, as long as they are free;
 * the rest take the lowest slot that is neither taken nor `reserved` (owned by a roster model that is not
 * racing), in input order.
 */
export function resolveEntries(items: EntryInput[], reserved: Iterable<number> = []): Entry[] {
  const codes = uniqueCodes(items);
  const taken = new Set<number>();
  const blocked = new Set(reserved);
  const slots = items.map((e) => {
    if (e.slot !== undefined && e.slot >= 1 && e.slot <= SLOT_COUNT && !taken.has(e.slot)) {
      taken.add(e.slot);
      return e.slot;
    }
    return -1;
  });
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== -1) continue;
    let s = 1;
    while (s <= SLOT_COUNT && (taken.has(s) || blocked.has(s))) s++;
    if (s <= SLOT_COUNT) {
      taken.add(s);
      slots[i] = s;
    } else slots[i] = 0;
  }
  return items.map((e, i) => {
    const slot = slots[i]!;
    return {
      id: e.id,
      name: e.name,
      code: codes[i]!,
      slot,
      provider: e.provider ?? "other",
      providerLabel: e.providerLabel ?? "Other",
      color: slot > 0 ? ENTRY_COLORS[slot - 1]! : COLORS["entry-none"],
      body: e.body ?? COLORS["body-graphite"],
    };
  });
}

/** Lookup by id, for components that hold a car id. */
export function entryMap(entries: Entry[]): Map<string, Entry> {
  return new Map(entries.map((e) => [e.id, e]));
}

/** The entry colour as a token reference (`var(--entry-04)`), so components follow the theme rather than a hex. */
export function entryVar(e: Pick<Entry, "slot"> | null | undefined): string {
  return e && e.slot > 0 ? `var(--entry-${String(e.slot).padStart(2, "0")})` : "var(--entry-none)";
}
