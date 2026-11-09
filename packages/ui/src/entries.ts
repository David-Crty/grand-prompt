/**
 * Entries: how a car is identified everywhere (tower, labels, trails, map, charts, video). Each entry gets a
 * three-letter code, a colour slot (1 to 12, unique within an event) and a provider, which picks the car's
 * body paint. Pure functions, shared by the viewer and the video.
 */
import { COLORS, ENTRY_COLORS } from "./tokens.gen.js";

export type Provider = "anthropic" | "openai" | "google" | "xai" | "mistral" | "house" | "other";

export interface EntryInput {
  id: string;
  name: string;
  /** Optional explicit metadata (models.json, or a replay that carries it). */
  code?: string;
  slot?: number;
  provider?: Provider;
}

export interface Entry {
  id: string;
  name: string;
  code: string;
  /** 1 to 12, or 0 for the house driver and entries past twelve without a free slot. */
  slot: number;
  provider: Provider;
  /** Entry colour (chip, label, trail, tower, map, charts, livery stripe). */
  color: string;
  /** 3D body paint for the provider. */
  body: string;
  house: boolean;
}

export const SLOT_COUNT = ENTRY_COLORS.length;

const PROVIDER_PREFIX: [RegExp, Provider][] = [
  [/^reference$|house/i, "house"],
  [/^claude/i, "anthropic"],
  [/^(gpt|o\d|openai|codex)/i, "openai"],
  [/^gemini|^gemma/i, "google"],
  [/^grok/i, "xai"],
  [/^(mistral|codestral|devstral|magistral)/i, "mistral"],
];

/** Provider from a model id (`claude-fable-5-1` is anthropic, `gpt-6-astra` openai). */
export function providerOf(id: string): Provider {
  for (const [re, p] of PROVIDER_PREFIX) if (re.test(id)) return p;
  return "other";
}

export const BODY_TOKEN: Record<Provider, keyof typeof COLORS> = {
  anthropic: "body-clay",
  openai: "body-silver",
  google: "body-cobalt",
  xai: "body-pearl",
  mistral: "body-saffron",
  house: "entry-house",
  other: "body-graphite",
};

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
  const codes = items.map((e) => (e.code ?? deriveCode(e.name)).toUpperCase());
  const seen = new Map<string, number>();
  for (const c of codes) seen.set(c, (seen.get(c) ?? 0) + 1);
  const used = new Set<string>();
  return codes.map((c, i) => {
    let code = c;
    if ((seen.get(c) ?? 0) > 1 && !items[i]!.code)
      code = `${c.slice(0, 2)}${versionDigit(items[i]!.name) || i + 1}`;
    let n = 1;
    while (used.has(code)) code = `${c.slice(0, 2)}${n++}`;
    used.add(code);
    return code;
  });
}

/**
 * Resolve every entry of one event. Explicit slots are honoured first, in order, as long as they are free;
 * the rest take the lowest free slot in input order. The house driver never takes a slot.
 */
export function resolveEntries(items: EntryInput[]): Entry[] {
  const codes = uniqueCodes(items);
  const taken = new Set<number>();
  const slots = items.map((e) => {
    const house = (e.provider ?? providerOf(e.id)) === "house";
    if (house) return 0;
    if (e.slot !== undefined && e.slot >= 1 && e.slot <= SLOT_COUNT && !taken.has(e.slot)) {
      taken.add(e.slot);
      return e.slot;
    }
    return -1;
  });
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== -1) continue;
    let s = 1;
    while (s <= SLOT_COUNT && taken.has(s)) s++;
    if (s <= SLOT_COUNT) {
      taken.add(s);
      slots[i] = s;
    } else slots[i] = 0;
  }
  return items.map((e, i) => {
    const provider = e.provider ?? providerOf(e.id);
    const slot = slots[i]!;
    return {
      id: e.id,
      name: e.name,
      code: codes[i]!,
      slot,
      provider,
      color: slot > 0 ? ENTRY_COLORS[slot - 1]! : COLORS["entry-house"],
      body: COLORS[BODY_TOKEN[provider]],
      house: provider === "house",
    };
  });
}

/** Lookup by id, for components that hold a car id. */
export function entryMap(entries: Entry[]): Map<string, Entry> {
  return new Map(entries.map((e) => [e.id, e]));
}

/** The entry colour as a token reference (`var(--entry-04)`), so components follow the theme rather than a hex. */
export function entryVar(e: Pick<Entry, "slot"> | null | undefined): string {
  return e && e.slot > 0 ? `var(--entry-${String(e.slot).padStart(2, "0")})` : "var(--entry-house)";
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  mistral: "Mistral",
  house: "House driver",
  other: "Other",
};
