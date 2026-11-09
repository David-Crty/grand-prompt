/** Timeline markers: one glyph per race event that matters for seeking (start, fastest laps, warnings, DNFs, finish). */
export type MarkerKind = "start" | "fastest" | "warn" | "dnf" | "finish";

export interface TimelineMarker {
  t: number;
  kind: MarkerKind;
  /** Tooltip, e.g. "SON out · Lap 1". */
  label: string;
  carIds: string[];
}

/** Which glyph wins when markers merge: a retirement outranks a warning, which outranks a fastest lap. */
const RANK: Record<MarkerKind, number> = { dnf: 4, warn: 3, finish: 2, fastest: 1, start: 0 };

/**
 * Markers closer than `minPx` on a timeline `widthPx` wide become one: the earliest time (so a click lands before
 * all of them), the highest-ranked glyph, every car and every label.
 */
export function mergeMarkers(
  markers: TimelineMarker[],
  duration: number,
  widthPx: number,
  minPx = 12,
): TimelineMarker[] {
  const sorted = [...markers].sort((a, b) => a.t - b.t);
  if (duration <= 0 || widthPx <= 0) return sorted;
  const px = (t: number) => (t / duration) * widthPx;
  const out: TimelineMarker[] = [];
  let anchor = Number.NEGATIVE_INFINITY;
  for (const m of sorted) {
    const prev = out[out.length - 1];
    if (prev && px(m.t) - anchor < minPx) {
      prev.kind = RANK[m.kind] > RANK[prev.kind] ? m.kind : prev.kind;
      prev.label = `${prev.label} · ${m.label}`;
      prev.carIds = [...new Set([...prev.carIds, ...m.carIds])];
      continue;
    }
    out.push({ ...m, carIds: [...m.carIds] });
    anchor = px(m.t);
  }
  return out;
}

/** The marker after (dir 1) or before (dir -1) time t, skipping any within `eps` s of t. */
export function stepMarker(
  markers: TimelineMarker[],
  t: number,
  dir: 1 | -1,
  eps = 0.5,
): TimelineMarker | null {
  const sorted = [...markers].sort((a, b) => a.t - b.t);
  if (dir > 0) return sorted.find((m) => m.t > t + eps) ?? null;
  for (let k = sorted.length - 1; k >= 0; k--) if (sorted[k]!.t < t - eps) return sorted[k]!;
  return null;
}
