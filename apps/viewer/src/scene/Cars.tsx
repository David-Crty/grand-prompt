import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { linearRgb } from "../lib/color.js";
import type { ViewerModel } from "../lib/model.js";
import { ribbonIndices } from "../lib/trail.js";
import { buildCarGeometries } from "./geometry.js";
import type { LiveState } from "./live.js";

export const TRAIL_POINTS = 90;

export function Cars({ model, live }: { model: ViewerModel; live: React.RefObject<LiveState> }) {
  const dims = model.replay.header.car;
  const geo = useMemo(() => buildCarGeometries(dims.length, dims.width, dims.wheelbase), [dims]);
  const shared = useMemo(
    () => ({
      detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 }),
      wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
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
        const paint = new THREE.MeshStandardMaterial({
          color: c.car.color,
          roughness: 0.32,
          metalness: 0.25,
        });
        const body = new THREE.Mesh(geo.body, paint);
        const detail = new THREE.Mesh(geo.detail, shared.detail);
        for (const m of [body, detail]) {
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
          pivot.add(mesh);
          group.add(pivot);
          wheels.push(mesh);
          if (w.front) {
            const upright = new THREE.Mesh(w.right ? geo.upright.right : geo.upright.left, shared.detail);
            upright.castShadow = true;
            pivot.add(upright);
            steer.push(pivot);
          }
        }
        const marker = new THREE.Mesh(
          shared.marker,
          new THREE.MeshBasicMaterial({
            color: c.car.color,
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
        const [r, g, b] = linearRgb(c.car.color);
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
        return { group, wheels, steer, marker, trail, paint, wheelRadius: geo.wheelRadius };
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
        b.paint.dispose();
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
