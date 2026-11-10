/**
 * The design tokens in `packages/ui/tokens.json` (copied from the Grand Prompt design system) are the one
 * source for colours, type, spacing and motion. This module reads them and generates the CSS custom
 * properties for the DOM and a typed module for three.js materials and Remotion. Pure: no file access.
 */

export interface ColorToken {
  name: string;
  /** The colour's name where people pick it (an entry colour in `models.json`). */
  label?: string;
  value: string | Record<string, string>;
  usage?: string;
}
export interface PlainToken {
  name: string;
  value: string;
  usage?: string;
}
export interface TypeStyle {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number | string;
  letterSpacing?: string;
  family?: string;
}
export interface TokenFile {
  name: string;
  version: number;
  color: { themes: { id: string; name: string }[]; tokens: ColorToken[] };
  type: {
    fonts: { family: string; file: string; weight: string; style?: string }[];
    families: Record<string, string>;
    groups: { name: string; family: string; styles: TypeStyle[] }[];
  };
  [family: string]: unknown;
}

/** Families other than `color` and `type` that hold `{ tokens: [{ name, value }] }`, in output order. */
export const PLAIN_FAMILIES = [
  "spacing",
  "radius",
  "shadow",
  "opacity",
  "blur",
  "duration",
  "easing",
  "zIndex",
  "size",
  "breakpoint",
] as const;

const ALIAS = /^\{([A-Za-z0-9_.-]+)\}$/;

function themeValue(t: ColorToken, theme: string): string {
  if (typeof t.value === "string") return t.value;
  return t.value[theme] ?? Object.values(t.value)[0] ?? "";
}

/** Colour token value with aliases (`{text-100}`) followed to a literal. Throws on a missing name or a cycle. */
export function resolveColor(tokens: TokenFile, name: string, theme?: string): string {
  const th = theme ?? tokens.color.themes[0]?.id ?? "";
  const byName = new Map(tokens.color.tokens.map((t) => [t.name, t]));
  let current = name;
  for (let depth = 0; depth < 16; depth++) {
    const t = byName.get(current);
    if (!t) throw new Error(`Unknown colour token ${current}`);
    const v = themeValue(t, th);
    const m = ALIAS.exec(v);
    if (!m) return v;
    current = m[1]!;
  }
  throw new Error(`Alias chain too deep at ${name}`);
}

function plain(tokens: TokenFile, family: string): PlainToken[] {
  const f = tokens[family] as { tokens?: PlainToken[] } | undefined;
  return f?.tokens ?? [];
}

function cssValue(v: string): string {
  const m = ALIAS.exec(v);
  return m ? `var(--${m[1]})` : v;
}

/** `tokens.css`: custom properties on :root, a class per type style, an @font-face per font. */
export function toCss(tokens: TokenFile, fontUrl: (file: string) => string): string {
  const th = tokens.color.themes[0]?.id ?? "";
  const out = [
    `/* ${tokens.name}: generated from tokens.json by scripts/gen-tokens.ts. Do not edit. */`,
    ":root {",
  ];
  for (const t of tokens.color.tokens) out.push(`  --${t.name}: ${cssValue(themeValue(t, th))};`);
  for (const fam of PLAIN_FAMILIES)
    for (const t of plain(tokens, fam)) out.push(`  --${t.name}: ${t.value};`);
  for (const [k, v] of Object.entries(tokens.type.families)) out.push(`  --font-${k}: ${v};`);
  out.push("}");
  for (const g of tokens.type.groups) {
    for (const s of g.styles) {
      const fam = tokens.type.families[s.family ?? g.family] ?? "inherit";
      const parts = [
        `font-family: ${fam}`,
        `font-size: ${s.fontSize}`,
        `line-height: ${s.lineHeight}`,
        `font-weight: ${s.fontWeight}`,
      ];
      if (s.letterSpacing) parts.push(`letter-spacing: ${s.letterSpacing}`);
      out.push(`.${s.name} { ${parts.join("; ")}; }`);
    }
  }
  for (const f of tokens.type.fonts) {
    out.push(
      `@font-face { font-family: "${f.family}"; src: url("${fontUrl(f.file)}") format("woff2"); ` +
        `font-weight: ${f.weight}; font-style: ${f.style ?? "normal"}; font-display: swap; }`,
    );
  }
  return `${out.join("\n")}\n`;
}

/** Name of the colour token for entry slot k (1 to 12). */
export function entryTokenName(slot: number): string {
  return `entry-${String(slot).padStart(2, "0")}`;
}

/** `tokens.gen.ts`: resolved colours and plain values as typed constants (for three.js, Remotion, tests). */
export function toTs(tokens: TokenFile): string {
  const colors: Record<string, string> = {};
  for (const t of tokens.color.tokens) colors[t.name] = resolveColor(tokens, t.name);
  const entries: string[] = [];
  const labels: string[] = [];
  for (let k = 1; colors[entryTokenName(k)] !== undefined; k++) {
    entries.push(colors[entryTokenName(k)]!);
    labels.push(tokens.color.tokens.find((t) => t.name === entryTokenName(k))?.label ?? entryTokenName(k));
  }
  const values: Record<string, string> = {};
  for (const fam of PLAIN_FAMILIES) for (const t of plain(tokens, fam)) values[t.name] = t.value;
  const lines = [
    "// Generated from packages/ui/tokens.json by scripts/gen-tokens.ts. Do not edit.",
    `export const COLORS = ${JSON.stringify(colors, null, 2)} as const;`,
    `export const ENTRY_COLORS = ${JSON.stringify(entries)} as const;`,
    `export const ENTRY_COLOR_NAMES = ${JSON.stringify(labels)} as const;`,
    `export const VALUES = ${JSON.stringify(values, null, 2)} as const;`,
    "export type ColorName = keyof typeof COLORS;",
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------- contrast (WCAG 2)

function channels(hex: string): { rgb: [number, number, number]; a: number } {
  const h = hex.replace(/^#/, "");
  const full = h.length === 3 || h.length === 4 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255;
  return { rgb: [n(0), n(2), n(4)], a: full.length === 8 ? n(6) : 1 };
}

/** Composite a colour with alpha over an opaque background, as #rrggbb. */
export function over(fg: string, bg: string): string {
  const f = channels(fg);
  const b = channels(bg);
  const mix = f.rgb.map((c, i) => Math.round((c * f.a + b.rgb[i]! * (1 - f.a)) * 255));
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function relativeLuminance(hex: string): number {
  const lin = channels(hex).rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
