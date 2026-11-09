import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { linearRgb } from "../lib/color.js";
import { type IndexedMesh, loft, openWheelerSections } from "../lib/loft.js";
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

function fromIndexed(m: IndexedMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
  g.setIndex(m.indices);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

function paint(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const g2 = g.index ? g.toNonIndexed() : g;
  const [r, gg, b] = linearRgb(hex);
  const n = g2.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) col.set([r, gg, b], k * 3);
  g2.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g2.deleteAttribute("uv");
  return g2;
}

function box(
  lx: number,
  ly: number,
  lz: number,
  x: number,
  y: number,
  z: number,
  rotZ = 0,
  rotY = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(lx, ly, lz);
  if (rotZ) g.rotateZ(rotZ);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

export interface CarGeometries {
  /** Painted in the car's color. */
  body: THREE.BufferGeometry;
  /** Carbon, helmet and accents, vertex colored. */
  detail: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
  wheelRadius: number;
  /** Wheel centres in car-local three coords (x forward, z right). */
  wheels: { x: number; z: number; front: boolean }[];
}

/** Generic low-poly open-wheeler, car-local: x forward, y up, z to the right, origin at the CG on the ground. */
export function buildCarGeometries(length: number, width: number, wheelbase: number): CarGeometries {
  const half = length / 2;
  const sec = openWheelerSections(length, width);
  const strip = (g: THREE.BufferGeometry) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute("uv");
    return n;
  };
  const body = mergeGeometries([
    fromIndexed(loft(sec.tub)),
    fromIndexed(loft(sec.sidepods)),
    fromIndexed(loft(sec.engine)),
    strip(box(0.9, 0.42, 0.04, -half * 0.45, 0.95, 0, 0)),
  ])!;
  const carbon = "#1b1c20";
  const wingY = 0.13;
  const fw = width - 0.12;
  const parts: THREE.BufferGeometry[] = [
    paint(box(3.3, 0.04, 1.4, -0.1, 0.035, 0), carbon),
    paint(box(0.55, 0.05, fw, half - 0.3, wingY, 0, 0.08), carbon),
    paint(box(0.35, 0.04, fw - 0.3, half - 0.45, wingY + 0.09, 0, 0.25), carbon),
    paint(box(0.6, 0.26, 0.03, half - 0.32, wingY + 0.05, fw / 2), "#f2f2f2"),
    paint(box(0.6, 0.26, 0.03, half - 0.32, wingY + 0.05, -fw / 2), "#f2f2f2"),
    paint(box(0.45, 0.05, 1.0, -half + 0.28, 0.98, 0, -0.12), carbon),
    paint(box(0.28, 0.04, 1.0, -half + 0.12, 1.1, 0, -0.45), carbon),
    paint(box(0.75, 0.62, 0.03, -half + 0.28, 0.82, 0.51), "#f2f2f2"),
    paint(box(0.75, 0.62, 0.03, -half + 0.28, 0.82, -0.51), "#f2f2f2"),
    paint(box(0.12, 0.5, 0.06, -half + 0.4, 0.68, 0), carbon),
    paint(new THREE.SphereGeometry(0.14, 10, 8).translate(-0.15, 0.74, 0), "#f5f5f0"),
    paint(box(0.18, 0.06, 0.26, -0.03, 0.76, 0), "#111111"),
  ];
  const halo = new THREE.TorusGeometry(0.34, 0.035, 5, 14, Math.PI);
  halo.rotateX(-Math.PI / 2);
  halo.rotateY(Math.PI / 2);
  halo.translate(-0.25, 0.92, 0);
  parts.push(paint(halo, carbon));
  parts.push(paint(box(0.05, 0.3, 0.05, 0.2, 0.78, 0, 0.5), carbon));
  const front = wheelbase / 2;
  const rear = -wheelbase / 2;
  const trackHalf = width / 2 - 0.2;
  for (const [x, zIn, zOut, y] of [
    [front, 0.15, trackHalf, 0.36],
    [rear, 0.35, trackHalf, 0.36],
  ] as const) {
    for (const side of [1, -1]) {
      const len = zOut - zIn;
      parts.push(paint(box(0.05, 0.03, len, x, y + 0.02, side * (zIn + len / 2), 0, 0.12 * side), carbon));
      parts.push(paint(box(0.05, 0.03, len, x, y - 0.12, side * (zIn + len / 2), 0, -0.12 * side), carbon));
    }
  }
  const detail = mergeGeometries(parts)!;

  const r = 0.36;
  const tyre = paint(new THREE.CylinderGeometry(r, r, 0.38, 18, 1).rotateX(Math.PI / 2), "#151515");
  const rimOut = paint(
    new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.392, 12, 1).rotateX(Math.PI / 2),
    "#9aa0a8",
  );
  const wheel = mergeGeometries([tyre, rimOut])!;
  return {
    body,
    detail,
    wheel,
    wheelRadius: r,
    wheels: [
      { x: front, z: trackHalf, front: true },
      { x: front, z: -trackHalf, front: true },
      { x: rear, z: trackHalf, front: false },
      { x: rear, z: -trackHalf, front: false },
    ],
  };
}
