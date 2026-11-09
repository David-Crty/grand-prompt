import { describe, expect, it } from "vitest";
import {
  buildCarMesh,
  CAR_MODEL,
  type CarModelFile,
  type CarPart,
  REAR_WING_SPAN_PER_WIDTH,
  TYRE_RADIUS_PER_WHEELBASE,
} from "../src/lib/carmodel.js";
import {
  buildRearWing,
  buildWheel,
  lathe,
  prism,
  signedVolume,
  WHEEL_SEGMENTS,
} from "../src/lib/carparts.js";

const extent = (parts: { positions: ArrayLike<number> }[], axis: number) => {
  let min = Infinity;
  let max = -Infinity;
  for (const p of parts)
    for (let i = axis; i < p.positions.length; i += 3) {
      min = Math.min(min, p.positions[i]!);
      max = Math.max(max, p.positions[i]!);
    }
  return [min, max] as const;
};

const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");

describe("procedural car parts", () => {
  it("builds closed, outward-wound solids", () => {
    const box = prism(
      [
        [0, 0],
        [0, 1],
        [2, 1],
        [2, 0],
      ],
      0,
      3,
    );
    expect(signedVolume(box)).toBeCloseTo(6);
    const disc = lathe(
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
      ],
      64,
    );
    expect(signedVolume(disc)).toBeCloseTo(Math.PI, 1);
    expect(disc.indices.length / 3).toBe(64 * 4);
    const ring = lathe(
      [
        [1, 1],
        [1, 2],
        [0, 2],
        [0, 1],
      ],
      64,
    );
    expect(signedVolume(ring)).toBeCloseTo(3 * Math.PI, 1);
  });

  it("turns every wheel part about the axle, so the wheel spins true", () => {
    const spec = { radius: 0.37, width: 0.38, rimRadius: 0.28, coverRadius: 0.26 };
    const parts = buildWheel(spec);
    for (const p of parts) {
      expect(signedVolume(p)).toBeGreaterThan(0);
      const [xMin, xMax] = extent([p], 0);
      expect(Math.abs(xMin + xMax)).toBeLessThan(0.08);
    }
    const tyre = parts[0]!;
    const radii = new Set<string>();
    for (let i = 0; i < tyre.positions.length; i += 3)
      radii.add(Math.hypot(tyre.positions[i]!, tyre.positions[i + 1]!).toFixed(6));
    expect(Math.max(...[...radii].map(Number))).toBeCloseTo(spec.radius, 6);
    expect(radii.size).toBeLessThanOrEqual(4);
    const [zMin, zMax] = extent(parts, 2);
    expect(zMax - zMin).toBeCloseTo(spec.width, 6);
    expect(tyre.indices.length / 3).toBe(WHEEL_SEGMENTS * 8 * 2);
  });

  it("builds a three-element rear wing ending at the tail", () => {
    const w = buildRearWing(-2.8, 1, 1);
    expect(w.painted).toHaveLength(4);
    expect(w.carbon).toHaveLength(3);
    const all = [...w.painted, ...w.carbon];
    for (const s of all) expect(signedVolume(s)).toBeGreaterThan(0);
    expect(extent(all, 0)[0]).toBeCloseTo(-2.8, 6);
    expect(extent(all, 1)[1]).toBeLessThanOrEqual(1);
    expect(extent([w.carbon[0]!], 2)[1]).toBeCloseTo(0.5, 6);
  });
});

describe("car model", () => {
  const m = buildCarMesh(5.6, 2, 3.6);
  const chassis = [...m.body, ...m.detail];

  it("fits the replay's length and width, with 2026 tyre and wing proportions", () => {
    const [rear, front] = extent(chassis, 0);
    expect(front - rear).toBeCloseTo(5.6, 3);
    const [left, right] = extent(chassis, 2);
    expect(Math.max(-left, right)).toBeLessThanOrEqual(1.001);
    expect(m.wheelRadius).toBeCloseTo(TYRE_RADIUS_PER_WHEELBASE * 3.6);
    expect(extent(m.wheel.right, 1)[1]).toBeCloseTo(m.wheelRadius, 6);
    expect(extent(chassis, 1)[0]).toBeGreaterThanOrEqual(-1e-6);
    expect(m.trackHalf + extent(m.wheel.right, 2)[1]).toBeLessThanOrEqual(1.001);
    const flap = m.body.at(-4)!;
    expect(extent([flap], 2)[1]).toBeCloseTo((REAR_WING_SPAN_PER_WIDTH * 2) / 2, 5);
  });

  it("has every role, paints the body, and mirrors the left side", () => {
    expect(m.upright.right).toHaveLength(1);
    expect(m.body.every((p) => p.color === null)).toBe(true);
    expect(m.detail.every((p) => typeof p.color === "string")).toBe(true);
    for (const [r, l] of [
      [m.wheel.right, m.wheel.left],
      [m.upright.right, m.upright.left],
    ] as const) {
      r.forEach((p: CarPart, k: number) => {
        const mirror = l[k]!;
        expect(signedVolume(mirror)).toBeCloseTo(signedVolume(p), 6);
        expect(extent([mirror], 2)[0]).toBeCloseTo(-extent([p], 2)[1], 6);
      });
    }
    const tris = [...chassis, ...m.wheel.right, ...m.upright.right].reduce(
      (n, p) => n + p.indices.length / 3,
      0,
    );
    expect(tris).toBeLessThan(3500);
    expect(CAR_MODEL.triangles).toBeLessThan(3000);
  });

  it("keeps a model with no overhang unscaled along x", () => {
    const file: CarModelFile = {
      triangles: 1,
      wheelbase: 2,
      width: 2,
      front: 1,
      rear: -1,
      wheel: { radius: 0.5, width: 0.4, rimRadius: 0.35, coverRadius: 0.3, track: 2 },
      parts: [
        {
          role: "body",
          color: null,
          positions: b64(new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0])),
          indices: b64(new Uint16Array([0, 1, 2])),
        },
      ],
    };
    const [rear, front] = extent([buildCarMesh(4, 2, 4, file).body[0]!], 0);
    expect(front - rear).toBeCloseTo(4);
  });
});
