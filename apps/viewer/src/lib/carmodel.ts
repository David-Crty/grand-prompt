import data from "./car-model.gen.json";
import { buildRearWing, buildWheel, type Solid } from "./carparts.js";

export type PartRole = "body" | "detail" | "wheel" | "upright";

/** The output of `scripts/import-car.ts`, in source units, car-local axes (x forward, y up, z right). */
export interface CarModelFile {
  triangles: number;
  wheelbase: number;
  width: number;
  /** Chassis extent along x, from the axle midpoint. */
  front: number;
  rear: number;
  wheel: { radius: number; width: number; rimRadius: number; coverRadius: number; track: number };
  parts: { role: string; color: string | null; positions: string; indices: string }[];
}

export interface CarPart {
  role: PartRole;
  /** null: painted in the car's colour. */
  color: string | null;
  positions: Float32Array;
  indices: Uint16Array;
}

export interface CarMesh {
  body: CarPart[];
  detail: CarPart[];
  /** The right wheel and front upright, centred on the axle; the left side is mirrored. */
  wheel: { right: CarPart[]; left: CarPart[] };
  upright: { right: CarPart[]; left: CarPart[] };
  wheelRadius: number;
  /** Lateral offset of each wheel centre from the centreline. */
  trackHalf: number;
}

export const CAR_MODEL = data as CarModelFile;

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function mirrored(p: CarPart): CarPart {
  const positions = p.positions.slice();
  for (let i = 2; i < positions.length; i += 3) positions[i] = -positions[i]!;
  const indices = p.indices.slice();
  for (let i = 0; i < indices.length; i += 3) {
    const t = indices[i + 1]!;
    indices[i + 1] = indices[i + 2]!;
    indices[i + 2] = t;
  }
  return { ...p, positions, indices };
}

/**
 * Tyre radius over wheelbase of a 2026 car (about 710 mm tyres on a 3.4 m wheelbase); the source
 * model's wheels are about a quarter larger than that.
 */
export const TYRE_RADIUS_PER_WHEELBASE = 0.355 / 3.4;
/** Rear wing span over overall car width (2026: about 1 m on a 1.9 m car). */
export const REAR_WING_SPAN_PER_WIDTH = 0.53;
/**
 * The fitted body stands about 12% taller than a real car (its hubs set its height), so the
 * wing is raised by as much to sit level with the roll hoop as it does on a 2026 car.
 */
export const REAR_WING_LIFT = 1.12;

const fromSolid = (role: PartRole, color: string | null, s: Solid): CarPart => ({
  role,
  color,
  positions: Float32Array.from(s.positions),
  indices: Uint16Array.from(s.indices),
});

/**
 * Fits the model to the replay's car with real proportions: the axles land on the sim's
 * wheelbase, the overhangs shrink or grow to the overall length, width sets the lateral scale,
 * and tyres are sized by TYRE_RADIUS_PER_WHEELBASE. The body is scaled vertically so the
 * suspension still meets the hubs. Wheels and the rear wing are built here rather than taken
 * from the source: its wheels are not round, and its wing predates the 2026 rules.
 */
export function buildCarMesh(
  length: number,
  width: number,
  wheelbase: number,
  file: CarModelFile = CAR_MODEL,
): CarMesh {
  const s = wheelbase / file.wheelbase;
  const sz = width / file.width;
  const wheelRadius = TYRE_RADIUS_PER_WHEELBASE * wheelbase;
  const sy = wheelRadius / file.wheel.radius;
  const axle = file.wheelbase / 2;
  const overhang = file.front - file.rear - file.wheelbase;
  const k = overhang > 0 ? Math.max(0, length - wheelbase) / (overhang * s) : 1;
  const bodyX = (x: number) => {
    const out = Math.abs(x) - axle;
    return Math.sign(x) * (out > 0 ? axle * s + out * s * k : Math.abs(x) * s);
  };
  const parts = file.parts.map((p): CarPart => {
    const role = p.role as PartRole;
    const q = new Float32Array(decode(p.positions).buffer);
    const onWheel = role === "upright";
    for (let i = 0; i < q.length; i += 3) {
      q[i] = onWheel ? q[i]! * sy : bodyX(q[i]!);
      q[i + 1] = q[i + 1]! * sy;
      q[i + 2] = q[i + 2]! * sz;
    }
    return { role, color: p.color, positions: q, indices: new Uint16Array(decode(p.indices).buffer) };
  });
  const of = (role: PartRole) => parts.filter((p) => p.role === role);
  const wheel = buildWheel({
    radius: wheelRadius,
    width: file.wheel.width * sz,
    rimRadius: file.wheel.rimRadius * sy,
    coverRadius: file.wheel.coverRadius * sy,
  }).map((w) => fromSolid("wheel", w.color, w));
  const f = wheelbase / 3.4;
  const wing = buildRearWing(bodyX(file.rear), REAR_WING_SPAN_PER_WIDTH * width, f, f * REAR_WING_LIFT);
  const upright = of("upright");
  return {
    body: [...of("body"), ...wing.painted.map((e) => fromSolid("body", null, e))],
    detail: [...of("detail"), ...wing.carbon.map((e) => fromSolid("detail", "#1b1c20", e))],
    wheel: { right: wheel, left: wheel.map(mirrored) },
    upright: { right: upright, left: upright.map(mirrored) },
    wheelRadius,
    trackHalf: (file.wheel.track / 2) * sz,
  };
}
