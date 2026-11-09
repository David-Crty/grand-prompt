import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLORS, ENTRY_COLORS } from "../src/tokens.gen.js";
import {
  contrastRatio,
  entryTokenName,
  over,
  relativeLuminance,
  resolveColor,
  type TokenFile,
  toCss,
  toTs,
} from "../src/tokens.js";

const dir = join(import.meta.dirname, "..");
const tokens = JSON.parse(readFileSync(join(dir, "tokens.json"), "utf8")) as TokenFile;

describe("generated files", () => {
  it("tokens.gen.css and tokens.gen.ts match tokens.json (run `make tokens` after editing it)", () => {
    expect(readFileSync(join(dir, "tokens.gen.css"), "utf8")).toBe(toCss(tokens, (f) => `./${f}`));
    expect(readFileSync(join(dir, "src/tokens.gen.ts"), "utf8")).toBe(toTs(tokens));
  });

  it("emits custom properties, aliases as var(), type classes and font faces", () => {
    const css = toCss(tokens, (f) => `/x/${f}`);
    expect(css).toContain("--ink-000: #07080a;");
    expect(css).toContain("--fill-chalk: var(--text-100);");
    expect(css).toContain("--space-4: 16px;");
    expect(css).toMatch(/\.data-m \{ font-family: .*font-size: 15px/);
    expect(css).toContain('url("/x/fonts/Archivo-Variable-latin.woff2")');
  });
});

describe("token names", () => {
  it("are unique across colour and plain families", () => {
    const names = tokens.color.tokens.map((t) => t.name);
    for (const fam of ["spacing", "radius", "shadow", "opacity", "size"]) {
      names.push(...((tokens[fam] as { tokens: { name: string }[] }).tokens ?? []).map((t) => t.name));
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("has twelve entry slots", () => {
    expect(ENTRY_COLORS).toHaveLength(12);
    expect(entryTokenName(3)).toBe("entry-03");
    expect(ENTRY_COLORS[1]).toBe(COLORS["entry-02"]);
  });
});

describe("resolveColor", () => {
  it("follows aliases and rejects unknown names and cycles", () => {
    expect(resolveColor(tokens, "fill-chalk")).toBe(COLORS["text-100"]);
    expect(() => resolveColor(tokens, "nope")).toThrow(/Unknown/);
    const loop: TokenFile = {
      ...tokens,
      color: { themes: [{ id: "a", name: "A" }], tokens: [{ name: "x", value: "{x}" }] },
    };
    expect(() => resolveColor(loop, "x")).toThrow(/too deep/);
    const themed: TokenFile = {
      ...tokens,
      color: { themes: [{ id: "a", name: "A" }], tokens: [{ name: "y", value: { b: "#111111" } }] },
    };
    expect(resolveColor(themed, "y")).toBe("#111111");
  });
});

describe("contrast floors (WCAG 2, every theme is the one dark theme)", () => {
  const scenery = ["#4a4d54", "#68a542", "#bcd3e6"]; // asphalt, grass, sky behind a HUD panel
  const grounds = [
    ...["surface-100", "surface-200", "surface-300", "surface-400", "ink-000"].map(
      (n) => COLORS[n as keyof typeof COLORS],
    ),
    ...scenery.map((s) => over(COLORS["hud-panel"], s)),
  ];
  const text = [
    "text-100",
    "text-200",
    "text-300",
    "timing-fastest",
    "timing-personal",
    "timing-slower",
    "status-dnf",
    "status-warn",
    "delta-ahead",
    "delta-behind",
  ] as const;

  it.each(text)("%s reads at 4.5:1 or more on every ground", (name) => {
    for (const g of grounds) expect(contrastRatio(COLORS[name], g)).toBeGreaterThanOrEqual(4.5);
  });

  it("on-chalk text reads on every entry colour and signal fill", () => {
    for (const c of [...ENTRY_COLORS, COLORS["status-dnf"], COLORS["status-warn"], COLORS["fill-chalk"]]) {
      expect(contrastRatio(COLORS["on-chalk"], c)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("entry colours hold 3:1 as marks on every ground", () => {
    for (const c of ENTRY_COLORS)
      for (const g of grounds) expect(contrastRatio(c, g)).toBeGreaterThanOrEqual(3);
  });

  it("composites alpha and computes luminance", () => {
    expect(over("#ffffff80", "#000000")).toBe("#808080");
    expect(over("#fff", "#000")).toBe("#ffffff");
    expect(relativeLuminance("#000000")).toBe(0);
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(() => relativeLuminance("red")).toThrow(/hex/);
  });
});
