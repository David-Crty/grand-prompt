/**
 * The roster (`models.json`): every model the benchmark knows, with what identifies it everywhere: name,
 * three-letter code, provider, entry colour and car body paint. Colours are token names (`entry-*` labels,
 * `body-*` suffixes), never hex, and each entry colour belongs to one model across every event.
 */
import { type Entry, type EntryInput, resolveEntries } from "./entries.js";
import { COLORS, ENTRY_COLOR_NAMES } from "./tokens.gen.js";

export interface RosterProvider {
  label: string;
  /** The coding CLI that builds this provider's models. */
  cli: string;
  /** Car body paint: a `body-*` token without its prefix. */
  body: string;
}

export interface RosterModel {
  id: string;
  name: string;
  code: string;
  provider: string;
  /** Entry colour: one of `ENTRY_COLOR_NAMES`, unique in the roster. */
  color: string;
  /** Overrides the provider's body paint. */
  body?: string;
  effort?: string;
}

export interface Roster {
  effort?: string;
  providers: Record<string, RosterProvider>;
  models: RosterModel[];
}

export const BODY_NAMES = Object.keys(COLORS)
  .filter((k) => k.startsWith("body-"))
  .map((k) => k.slice("body-".length));

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The roster, checked: every field present, codes and colours unique, colours and bodies real tokens. */
export function parseRoster(raw: unknown): Roster {
  const fail: (msg: string) => never = (msg) => {
    throw new Error(`models.json: ${msg}`);
  };
  if (!isObject(raw)) fail("not an object");
  const r = raw as Record<string, unknown>;
  if (r.effort !== undefined && typeof r.effort !== "string") fail("effort is a string");
  if (!isObject(r.providers)) fail("providers is an object of provider id to { label, cli, body }");
  if (!Array.isArray(r.models)) fail("models is a list");
  const str = (o: Record<string, unknown>, k: string, where: string) =>
    typeof o[k] === "string" && o[k] !== "" ? (o[k] as string) : fail(`${where}: missing ${k}`);
  const body = (v: string, where: string) =>
    BODY_NAMES.includes(v) ? v : fail(`${where}: unknown body '${v}' (${BODY_NAMES.join(", ")})`);

  const providers: Record<string, RosterProvider> = {};
  for (const [id, p] of Object.entries(r.providers as object)) {
    if (!isObject(p)) fail(`provider ${id} is an object`);
    const o = p as Record<string, unknown>;
    const where = `provider ${id}`;
    providers[id] = {
      label: str(o, "label", where),
      cli: str(o, "cli", where),
      body: body(str(o, "body", where), where),
    };
  }

  const seen = { id: new Set<string>(), code: new Set<string>(), color: new Set<string>() };
  const once = (kind: keyof typeof seen, v: string, where: string) => {
    if (seen[kind].has(v)) fail(`${where}: ${kind} '${v}' is already taken`);
    seen[kind].add(v);
  };
  const models = (r.models as unknown[]).map((m, i): RosterModel => {
    if (!isObject(m)) fail(`model ${i + 1} is an object`);
    const id = str(m, "id", `model ${i + 1}`);
    const out: RosterModel = {
      id,
      name: str(m, "name", id),
      code: str(m, "code", id),
      provider: str(m, "provider", id),
      color: str(m, "color", id),
    };
    if (!/^[A-Z][A-Z0-9]{2}$/.test(out.code)) fail(`${id}: code '${out.code}' is three capitals or digits`);
    if (!(out.provider in providers)) fail(`${id}: unknown provider '${out.provider}'`);
    if (!(ENTRY_COLOR_NAMES as readonly string[]).includes(out.color))
      fail(`${id}: unknown color '${out.color}' (${ENTRY_COLOR_NAMES.join(", ")})`);
    if (m.body !== undefined) out.body = body(String(m.body), id);
    if (m.effort !== undefined)
      out.effort = typeof m.effort === "string" ? m.effort : fail(`${id}: effort is a string`);
    once("id", id, id);
    once("code", out.code, id);
    once("color", out.color, id);
    return out;
  });
  return { ...(r.effort !== undefined ? { effort: r.effort as string } : {}), providers, models };
}

/** The colour slot (1 to 12) of an entry colour name. */
export function colorSlot(name: string): number {
  return (ENTRY_COLOR_NAMES as readonly string[]).indexOf(name) + 1;
}

/** What the roster says about one model, as `resolveEntries` takes it. */
export function rosterInput(m: RosterModel, roster: Roster): EntryInput {
  const p = roster.providers[m.provider]!;
  return {
    id: m.id,
    name: m.name,
    code: m.code,
    slot: colorSlot(m.color),
    provider: m.provider,
    providerLabel: p.label,
    body: COLORS[`body-${m.body ?? p.body}` as keyof typeof COLORS],
  };
}

/**
 * Entries of one event: a car on the roster (matched by id, which is its folder under `drivers/<event>/`)
 * takes its identity from there; any other car gets a code from its name and a colour no roster model owns.
 */
export function rosterEntries(items: { id: string; name: string }[], roster: Roster): Entry[] {
  const byId = new Map(roster.models.map((m) => [m.id, m]));
  const reserved = roster.models.map((m) => colorSlot(m.color));
  return resolveEntries(
    items.map((c) => {
      const m = byId.get(c.id);
      return m ? rosterInput(m, roster) : { id: c.id, name: c.name };
    }),
    reserved,
  );
}
