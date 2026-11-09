import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildCarMesh, type CarPart } from "../lib/carmodel.js";
import { linearRgb } from "../lib/color.js";
import type { MeshBuilder } from "../lib/track.js";

export function fromBuilder(m: MeshBuilder): THREE.BufferGeometry {
  const a = m.toArrays();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(a.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(a.normals, 3));
  g.setAttribute("color", new THREE.BufferAttribute(a.colors, 3));
  g.computeBoundingSphere();
  return g;
}

function fromPart(p: CarPart, color: string | null): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p.positions, 3));
  g.setIndex(new THREE.BufferAttribute(p.indices, 1));
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  if (color) {
    const [r, gg, b] = linearRgb(color);
    const n = flat.getAttribute("position").count;
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([r, gg, b], k * 3);
    flat.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  return flat;
}

const merged = (parts: CarPart[], colored: boolean) =>
  mergeGeometries(parts.map((p) => fromPart(p, colored ? (p.color ?? "#ffffff") : null)))!;

export interface CarGeometries {
  /** Painted in the provider's body colour. */
  body: THREE.BufferGeometry;
  /** Painted in the entry colour: top stripe and rear-wing endplates. */
  livery: THREE.BufferGeometry;
  /** Carbon, wings and accents, vertex colored. */
  detail: THREE.BufferGeometry;
  /** Vertex colored, centred on the axle; spun around z. */
  wheel: { right: THREE.BufferGeometry; left: THREE.BufferGeometry };
  /** Front brake ducts: steer with the wheel but do not spin. */
  upright: { right: THREE.BufferGeometry; left: THREE.BufferGeometry };
  wheelRadius: number;
  /** Wheel centres in car-local three coords (x forward, z right). */
  wheels: { x: number; z: number; front: boolean; right: boolean }[];
}

/** The imported open-wheeler (car-model.gen.json), car-local: x forward, y up, z right, origin mid-wheelbase on the ground. */
export function buildCarGeometries(length: number, width: number, wheelbase: number): CarGeometries {
  const m = buildCarMesh(length, width, wheelbase);
  const sided = (s: { right: CarPart[]; left: CarPart[] }) => ({
    right: merged(s.right, true),
    left: merged(s.left, true),
  });
  const wheels = [true, false].flatMap((front) =>
    [true, false].map((right) => ({
      x: ((front ? 1 : -1) * wheelbase) / 2,
      z: (right ? 1 : -1) * m.trackHalf,
      front,
      right,
    })),
  );
  return {
    body: merged(m.body, false),
    livery: merged(m.livery, false),
    detail: merged(m.detail, true),
    wheel: sided(m.wheel),
    upright: sided(m.upright),
    wheelRadius: m.wheelRadius,
    wheels,
  };
}
