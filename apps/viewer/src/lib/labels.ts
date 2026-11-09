export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lower draws first and yields; the nearest label keeps its place. */
  priority: number;
}

/**
 * Vertical offsets (px, negative = up) so overlapping screen labels stack instead of covering
 * each other. Labels are anchored bottom-centre at (x, y).
 */
export function stackLabels(boxes: LabelBox[], gap = 2): number[] {
  const order = boxes.map((_, k) => k).sort((a, b) => boxes[b]!.priority - boxes[a]!.priority);
  const placed: { x: number; top: number; bottom: number; w: number }[] = [];
  const offsets = new Array<number>(boxes.length).fill(0);
  for (const k of order) {
    const b = boxes[k]!;
    let bottom = b.y;
    let moved = true;
    while (moved) {
      moved = false;
      for (const p of placed) {
        const overlapX = Math.abs(p.x - b.x) < (p.w + b.w) / 2;
        const overlapY = bottom > p.top - gap && bottom - b.h < p.bottom + gap;
        if (overlapX && overlapY) {
          bottom = p.top - gap;
          moved = true;
        }
      }
    }
    offsets[k] = bottom - b.y;
    placed.push({ x: b.x, top: bottom - b.h, bottom, w: b.w });
  }
  return offsets;
}
