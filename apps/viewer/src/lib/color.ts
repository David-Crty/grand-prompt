export type RGB = [number, number, number];

/** "#rrggbb" or "#rgb" to sRGB components in 0..1. Invalid input gives mid grey. */
export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0.5, 0.5, 0.5];
  const v = Number.parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear-space color for vertex attributes (three treats vertex colors as linear). */
export function linearRgb(hex: string, scale = 1): RGB {
  const [r, g, b] = hexToRgb(hex);
  return [srgbToLinear(r) * scale, srgbToLinear(g) * scale, srgbToLinear(b) * scale];
}
