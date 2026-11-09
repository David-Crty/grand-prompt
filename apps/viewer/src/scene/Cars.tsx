import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { linearRgb } from "../lib/color.js";
import type { ViewerModel } from "../lib/model.js";
import { ribbonIndices } from "../lib/trail.js";
import { buildCarGeometries } from "./geometry.js";
import type { LiveState } from "./live.js";

export const TRAIL_POINTS = 90;

/** Opacity of a ghost car: one overlapping another car's run in a ghost race (lib/pack.ts). */
export const GHOST_OPACITY = 0.38;

function ghostOf<M extends THREE.Material>(m: M): M {
  const g = m.clone() as M;
  g.transparent = true;
  g.opacity = GHOST_OPACITY;
  return g;
}

export function Cars({ model, live }: { model: ViewerModel; live: React.RefObject<LiveState> }) {
  const dims = model.replay.header.car;
  const geo = useMemo(() => buildCarGeometries(dims.length, dims.width, dims.wheelbase), [dims]);
  const shared = useMemo(
    () => ({
      detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 }),
      wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      detailGhost: ghostOf(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 }),
      ),
      wheelGhost: ghostOf(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })),
      marker: new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
      trailIndex: ribbonIndices(TRAIL_POINTS),
    }),
    [],
  );
  const built = useMemo(
    () =>
      model.cars.map((c) => {
        const group = new THREE.Group();
        group.name = c.car.id;
        // Bodywork shows the provider; the entry colour rides on the stripe, trail, marker and labels.
        const entry = model.entries.get(c.car.id)!;
        const paint = new THREE.MeshStandardMaterial({
          color: entry.body,
          roughness: 0.32,
          metalness: 0.25,
        });
        const livery = new THREE.MeshStandardMaterial({ color: entry.color, roughness: 0.4, metalness: 0.1 });
        const body = new THREE.Mesh(geo.body, paint);
        const stripe = new THREE.Mesh(geo.livery, livery);
        const detail = new THREE.Mesh(geo.detail, shared.detail);
        const paintGhost = ghostOf(paint);
        const liveryGhost = ghostOf(livery);
        // Each mesh with its solid and ghost material, swapped by setGhost.
        const swaps: [THREE.Mesh, THREE.Material, THREE.Material][] = [
          [body, paint, paintGhost],
          [stripe, livery, liveryGhost],
          [detail, shared.detail, shared.detailGhost],
        ];
        for (const m of [body, stripe, detail]) {
          m.castShadow = true;
          m.receiveShadow = true;
          group.add(m);
        }
        const wheels: THREE.Object3D[] = [];
        const steer: THREE.Object3D[] = [];
        for (const w of geo.wheels) {
          const pivot = new THREE.Group();
          pivot.position.set(w.x, geo.wheelRadius, w.z);
          const mesh = new THREE.Mesh(w.right ? geo.wheel.right : geo.wheel.left, shared.wheel);
          mesh.castShadow = true;
          swaps.push([mesh, shared.wheel, shared.wheelGhost]);
          pivot.add(mesh);
          group.add(pivot);
          wheels.push(mesh);
          if (w.front) {
            const upright = new THREE.Mesh(w.right ? geo.upright.right : geo.upright.left, shared.detail);
            upright.castShadow = true;
            swaps.push([upright, shared.detail, shared.detailGhost]);
            pivot.add(upright);
            steer.push(pivot);
          }
        }
        const marker = new THREE.Mesh(
          shared.marker,
          new THREE.MeshBasicMaterial({
            color: entry.color,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          }),
        );
        marker.position.y = 0.2;
        marker.renderOrder = 2;
        marker.visible = false;
        group.add(marker);

        const tg = new THREE.BufferGeometry();
        tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 6), 3));
        const col = new Float32Array(TRAIL_POINTS * 8);
        const [r, g, b] = linearRgb(entry.color);
        for (let k = 0; k < TRAIL_POINTS * 2; k++) col.set([r, g, b, 0], k * 4);
        tg.setAttribute("color", new THREE.BufferAttribute(col, 4));
        tg.setIndex(new THREE.BufferAttribute(shared.trailIndex, 1));
        const trail = new THREE.Mesh(
          tg,
          new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -4,
          }),
        );
        trail.frustumCulled = false;
        trail.renderOrder = 1;
        let ghosted = false;
        const setGhost = (on: boolean) => {
          if (on === ghosted) return;
          ghosted = on;
          for (const [mesh, solid, ghost] of swaps) {
            mesh.material = on ? ghost : solid;
            mesh.castShadow = !on;
            mesh.renderOrder = on ? 3 : 0;
          }
        };
        const materials = [paint, livery, paintGhost, liveryGhost];
        return { group, wheels, steer, marker, trail, materials, setGhost, wheelRadius: geo.wheelRadius };
      }),
    [model, geo, shared],
  );
  useLayoutEffect(() => {
    built.forEach((b, k) => {
      live.current.cars[k] = b;
    });
    return () => {
      built.forEach((b, k) => {
        live.current.cars[k] = null;
        for (const m of b.materials) m.dispose();
        b.trail.geometry.dispose();
      });
    };
  }, [built, live]);
  return (
    <group>
      {built.map((b, k) => (
        <group key={model.cars[k]!.car.id}>
          <primitive object={b.group} />
          <primitive object={b.trail} />
        </group>
      ))}
    </group>
  );
}
