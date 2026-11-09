/**
 * Converts the car STL in cars/sources/ into apps/viewer/src/lib/car-model.gen.json: split into
 * connected parts, each given a role and a colour, decimated with meshoptimizer, and moved
 * into car-local axes (x forward, y up, z right, origin mid-wheelbase on the ground).
 *
 *   pnpm tsx scripts/import-car.ts [--error 0.01] [--out <file>] [--list]
 *
 * --error is the simplifier's absolute error in model units (the source is ~7.3 units between
 * axles); 0 keeps every triangle.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { MeshoptSimplifier } from "meshoptimizer";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]! : def;
};
const src = opt("--src", "cars/sources/f1-car-low-poly.stl");
const out = opt("--out", "apps/viewer/src/lib/car-model.gen.json");
const maxError = Number(opt("--error", "0.01"));
const list = args.includes("--list");

type V3 = [number, number, number];
interface Part {
  tris: number[][];
  min: V3;
  max: V3;
}

const buf = readFileSync(src);
const count = buf.readUInt32LE(80);
const ids = new Map<string, number>();
const verts: V3[] = [];
const tris: number[][] = [];
for (let i = 0; i < count; i++) {
  const o = 84 + i * 50 + 12;
  const t: number[] = [];
  for (let v = 0; v < 3; v++) {
    const p: V3 = [0, 1, 2].map((a) => buf.readFloatLE(o + v * 12 + a * 4)) as V3;
    const key = p.map((x) => x.toFixed(5)).join(",");
    let id = ids.get(key);
    if (id === undefined) {
      id = verts.length;
      ids.set(key, id);
      verts.push(p);
    }
    t.push(id);
  }
  if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) tris.push(t);
}

const parent = verts.map((_, i) => i);
const find = (x: number): number => {
  while (parent[x] !== x) {
    parent[x] = parent[parent[x]!]!;
    x = parent[x]!;
  }
  return x;
};
for (const [a, b, c] of tris) {
  parent[find(a!)] = find(b!);
  parent[find(a!)] = find(c!);
}
const byRoot = new Map<number, Part>();
for (const t of tris) {
  const r = find(t[0]!);
  let p = byRoot.get(r);
  if (!p) {
    p = { tris: [], min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
    byRoot.set(r, p);
  }
  p.tris.push(t);
  for (const v of t)
    for (let a = 0; a < 3; a++) {
      p.min[a] = Math.min(p.min[a]!, verts[v]![a]!);
      p.max[a] = Math.max(p.max[a]!, verts[v]![a]!);
    }
}
const parts = [...byRoot.values()];
const center = (p: Part) => p.min.map((m, a) => (m + p.max[a]!) / 2) as V3;
const size = (p: Part) => p.min.map((m, a) => p.max[a]! - m) as V3;

// Source axes: x to the left, y backwards (the front wing is at -y), z up.
const tyres = parts.filter((p) => {
  const s = size(p);
  return Math.abs(s[1] - s[2]) < 0.1 && s[2] > 1.5;
});
if (tyres.length !== 4) throw new Error(`expected 4 tyres, found ${tyres.length}`);
const ys = tyres.map((p) => center(p)[1]);
const frontY = Math.min(...ys);
const rearY = Math.max(...ys);
const wheelX = Math.max(...tyres.map((p) => Math.abs(center(p)[0])));
/** Least-squares circle through points in the (y, z) plane: [centreY, centreZ]. */
function fitCircle(pts: [number, number][]): [number, number] {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const B = [0, 0, 0];
  for (const [y, z] of pts) {
    const row = [y, z, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) A[i]![j]! += row[i]! * row[j]!;
      B[i]! -= row[i]! * (y * y + z * z);
    }
  }
  const det = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const d = det(A);
  const sol = [0, 1, 2].map((k) => det(A.map((r, i) => r.map((v, j) => (j === k ? B[i]! : v)))) / d);
  return [-sol[0]! / 2, -sol[1]! / 2];
}
const partVerts = (p: Part) => [...new Set(p.tris.flat())].map((v) => verts[v]!);
/** Outer radius of a wheel part about the axle (y, z). */
const radiusAbout = (p: Part, y: number, z: number) =>
  Math.max(...partVerts(p).map((v) => Math.hypot(v[1] - y, v[2] - z)));

// The STL's wheels are sculpted, not turned, so they wobble when spun: the viewer builds round
// wheels from these measurements instead.
const frontRight = tyres.find((p) => center(p)[1] === frontY && center(p)[0] < 0)!;
const ring = partVerts(frontRight);
const rough = center(frontRight);
const rmax = Math.max(...ring.map((v) => Math.hypot(v[1] - rough[1], v[2] - rough[2])));
const [axleY, axleZ] = fitCircle(
  ring.filter((v) => Math.hypot(v[1] - rough[1], v[2] - rough[2]) > 0.97 * rmax).map((v) => [v[1], v[2]]),
);
const tyreRadius = radiusAbout(frontRight, axleY, axleZ);
const groundZ = axleZ - tyreRadius;
const midY = (frontY + rearY) / 2;
const width = Math.max(...parts.map((p) => p.max[0])) - Math.min(...parts.map((p) => p.min[0]));
const wheelParts = parts.filter((p) => {
  const c = center(p);
  return Math.abs(c[1] - frontY) < 0.05 && c[0] < 0 && Math.abs(c[2] - axleZ) < 0.05;
});
const discs = wheelParts.filter((p) => p !== frontRight);
const rimRadius = Math.max(...discs.map((p) => radiusAbout(p, axleY, axleZ)));
const coverRadius = Math.min(...discs.map((p) => radiusAbout(p, axleY, axleZ)));

const PAINT = null;
const CARBON = "#1b1c20";
const WHITE = "#f2f2f2";

type Role = "body" | "detail" | "upright" | "drop";
interface Classified {
  role: Role;
  color: string | null;
  /** For wheels and uprights: the wheel this part belongs to. */
  wheel?: { front: boolean; right: boolean };
}

/** The front right upright is kept; the left one is mirrored at runtime. */
function classify(p: Part): Classified {
  const c = center(p);
  const s = size(p);
  const nearWheelY = [frontY, rearY].find((y) => Math.abs(c[1] - y) < 0.3);
  const right = c[0] < 0;
  if (nearWheelY !== undefined && Math.abs(Math.abs(c[0]) - wheelX) < 0.45) {
    const wheel = { front: nearWheelY === frontY, right };
    if (Math.abs(s[1] - s[2]) < 0.05 && Math.abs(c[2] - axleZ) < 0.05) return { role: "drop", color: null };
    if (wheel.front) return { role: "upright", color: CARBON, wheel };
  }
  if (Math.abs(c[0]) < 0.01 && s[1] > 9) return { role: "body", color: PAINT };
  if (s[1] > 8) return { role: "detail", color: CARBON }; // floor
  if (s[1] > 4 && s[2] > 1) return { role: "body", color: PAINT }; // sidepods
  if (c[1] > rearY + 0.6 && c[2] > 1.5) return { role: "drop", color: null }; // rear wing: rebuilt as a 2026 one
  if (c[1] < frontY - 1.2 && s[0] > 5) return { role: "body", color: PAINT }; // front wing main plane
  if (c[2] > 2.3) return { role: "detail", color: WHITE }; // camera pod above the airbox
  return { role: "detail", color: CARBON };
}

/** Source coords to car-local: x forward, y up, z right (a proper rotation, so winding holds). */
function toLocal(p: V3, origin: V3): V3 {
  return [-(p[1] - origin[1]), p[2] - origin[2], -(p[0] - origin[0])];
}

await MeshoptSimplifier.ready;
interface OutPart {
  role: Role;
  color: string | null;
  positions: string;
  indices: string;
}
const outParts: OutPart[] = [];
let before = 0;
let after = 0;
let front = -Infinity;
let rear = Infinity;
parts.forEach((p, k) => {
  const cl = classify(p);
  if (!cl.wheel)
    for (const v of partVerts(p)) {
      front = Math.max(front, -(v[1] - midY));
      rear = Math.min(rear, -(v[1] - midY));
    }
  if (list) {
    const f = (v: V3) => v.map((x) => x.toFixed(2)).join(" ");
    console.log(k, p.tris.length, "c", f(center(p)), "s", f(size(p)), cl.role, cl.color ?? "paint");
  }
  before += p.tris.length;
  if (cl.role === "drop") return;
  if (cl.wheel && !cl.wheel.right) return;
  const origin: V3 = cl.wheel ? [-wheelX, axleY, axleZ] : [0, midY, groundZ];
  const local = new Map<number, number>();
  const pos: number[] = [];
  const idx: number[] = [];
  for (const t of p.tris)
    for (const v of t) {
      let id = local.get(v);
      if (id === undefined) {
        id = local.size;
        local.set(v, id);
        pos.push(...toLocal(verts[v]!, origin));
      }
      idx.push(id);
    }
  let indices: Uint32Array<ArrayBufferLike> = Uint32Array.from(idx);
  const positions = Float32Array.from(pos);
  if (maxError > 0) {
    [indices] = MeshoptSimplifier.simplify(indices, positions, 3, 0, maxError, ["ErrorAbsolute"]);
  }
  after += (indices.length / 3) * (cl.role === "upright" ? 2 : 1);
  if (indices.length === 0) return;
  const remap = new Map<number, number>();
  const packed: number[] = [];
  const compact = Array.from(indices, (v) => {
    let n = remap.get(v);
    if (n === undefined) {
      n = remap.size;
      remap.set(v, n);
      packed.push(positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!);
    }
    return n;
  });
  const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");
  outParts.push({
    role: cl.role,
    color: cl.color,
    positions: b64(Float32Array.from(packed)),
    indices: b64(Uint16Array.from(compact)),
  });
});

const model = {
  source: src.split("/").pop(),
  maxError,
  triangles: after,
  wheelbase: rearY - frontY,
  width,
  /** Chassis extent along x, including the source rear wing that the viewer replaces. */
  front,
  rear,
  wheel: {
    radius: tyreRadius,
    width: size(frontRight)[0],
    rimRadius,
    coverRadius,
    track: 2 * wheelX,
  },
  parts: outParts,
};
writeFileSync(out, `${JSON.stringify(model, null, 1)}\n`);
console.log(`${before} -> ${after} triangles kept from the STL at error ${maxError}, ${out}`);
