import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import {
  blendWeight,
  cameraAhead,
  cameraPassed,
  chasePose,
  fitFov,
  heliPose,
  mapPose,
  onboardPose,
  type Pose,
  tracksidePose,
} from "../lib/camera.js";
import { damp, damp3, dampAngle, type Vec3 } from "../lib/coords.js";
import { directorStep } from "../lib/director.js";
import { sampleCar } from "../lib/frames.js";
import { type LabelBox, stackLabels } from "../lib/labels.js";
import type { ViewerModel } from "../lib/model.js";
import { liveStandings } from "../lib/timing.js";
import { trailRibbon } from "../lib/trail.js";
import { TRAIL_POINTS } from "./Cars.js";
import type { LiveState } from "./live.js";
import { SUN_DIR } from "./World.js";

const UP = new THREE.Vector3(0, 1, 0);
const MAP_UP = new THREE.Vector3(0, 0, -1);

/** The single per-frame loop: advances the clock, poses cars, trails, labels, camera and sun. */
export function Driver({
  model,
  live,
  lightRef,
}: {
  model: ViewerModel;
  live: React.RefObject<LiveState>;
  lightRef: React.RefObject<THREE.DirectionalLight | null>;
}) {
  const { camera, size, scene, gl } = useThree();
  const tmp = useMemo(
    () => ({
      v: new THREE.Vector3(),
      trailPos: new Float32Array(TRAIL_POINTS * 6),
      alpha: new Float32Array(TRAIL_POINTS * 2),
    }),
    [],
  );
  const idOf = useMemo(() => new Map(model.cars.map((c, k) => [c.car.id, k])), [model]);
  const maxSteer = 0.35;

  useFrame((_, dt) => {
    const t0 = performance.now();
    const L = live.current;
    const cam = camera as THREE.PerspectiveCamera;
    const prevT = L.clock.t;
    const t = L.clock.advance(dt);
    if (Math.abs(t - prevT) > Math.max(2, L.clock.speed * dt * 4)) L.cam.init = false;
    const wall = performance.now() / 1000;

    model.cars.forEach((c, k) => {
      L.samples[k] = sampleCar(c, t);
    });
    L.rows = liveStandings(model.cars, t, model.totalLaps);
    const mapMode = L.mode === "map";

    model.cars.forEach((c, k) => {
      const h = L.cars[k];
      const s = L.samples[k]!;
      if (!h) return;
      h.group.position.set(s.x, 0, -s.y);
      h.group.rotation.y = s.yaw;
      for (const p of h.steer) p.rotation.y = s.steer * maxSteer;
      const spin =
        (L.wheelSpin[k] ?? 0) -
        (s.ended ? 0 : (s.speed * dt * L.clock.speed * (L.clock.playing ? 1 : 0)) / 0.36);
      L.wheelSpin[k] = spin;
      for (const w of h.wheels) w.rotation.z = spin;
      h.marker.visible = mapMode;
      h.marker.scale.setScalar(mapMode ? 13 : 1);
      h.trail.visible = L.trails;
      if (L.trails) {
        const secs = mapMode ? 25 : L.mode === "tv" ? 4 : 1.5;
        const width = mapMode ? 4.5 : 0.35;
        const used = trailRibbon(
          c,
          t,
          secs,
          TRAIL_POINTS,
          width,
          mapMode ? 0.3 : 0.12,
          tmp.trailPos,
          tmp.alpha,
          mapMode ? 0.03 : 0.15,
        );
        const pos = h.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
        const col = h.trail.geometry.getAttribute("color") as THREE.BufferAttribute;
        (pos.array as Float32Array).set(tmp.trailPos);
        const ca = col.array as Float32Array;
        const fade = s.ended ? 0 : mapMode ? 0.9 : 0.5;
        for (let v = 0; v < TRAIL_POINTS * 2; v++) ca[v * 4 + 3] = used ? tmp.alpha[v]! * fade : 0;
        pos.needsUpdate = true;
        col.needsUpdate = true;
      }
    });

    let focusIdx = idOf.get(L.focusId) ?? 0;
    let pose: Pose;
    let key: string = L.mode;
    let lambda = 0;
    if (L.mode === "tv") {
      L.shot = directorStep(L.shot, L.rows, {
        wallTime: wall,
        speed: L.clock.playing ? L.clock.speed : 1,
        forced: L.manualFocus ? L.focusId : null,
        nextCam: (id) => cameraAhead(model.cams, L.samples[idOf.get(id) ?? 0]!.s, model.layout.length),
        camPassed: (ci, id) =>
          cameraPassed(model.cams[ci]!.s, L.samples[idOf.get(id) ?? 0]!.s, model.layout.length),
      });
      const shot = L.shot;
      focusIdx = idOf.get(shot.primary) ?? 0;
      if (!L.manualFocus) L.focusId = shot.primary;
      const a = L.samples[focusIdx]!;
      if (shot.kind === "trackside" && model.cams[shot.cam]) {
        pose = tracksidePose(model.cams[shot.cam]!, a, shot.secondary ? 24 : 15);
        key = `ts${shot.cam}`;
        lambda = 14;
      } else {
        const frameFor = (fkey: string) => {
          const [p, q] = fkey.split("|");
          const pa = L.samples[idOf.get(p ?? "") ?? focusIdx]!;
          const qi = q ? idOf.get(q) : undefined;
          if (qi !== undefined) {
            const b = L.samples[qi]!;
            const d = Math.hypot(b.x - pa.x, b.y - pa.y);
            if (d < 90) return { x: (pa.x + b.x) / 2, y: (pa.y + b.y) / 2, spread: d };
          }
          return { x: pa.x, y: pa.y, spread: 0 };
        };
        const fkey = `${shot.primary}|${shot.secondary ?? ""}`;
        const fresh = !L.cam.init || L.cam.key !== "heli";
        if (fresh) {
          L.cam.focusKey = fkey;
          L.cam.fromKey = fkey;
        } else if (fkey !== L.cam.focusKey) {
          L.cam.fromKey = L.cam.focusKey;
          L.cam.focusKey = fkey;
          L.cam.blendStart = wall;
        }
        const to = frameFor(fkey);
        const from = frameFor(L.cam.fromKey);
        const w = blendWeight(wall - L.cam.blendStart, 1.8);
        const fx = from.x + (to.x - from.x) * w;
        const fy = from.y + (to.y - from.y) * w;
        const spread = from.spread + (to.spread - from.spread) * w;
        L.cam.heading = fresh
          ? a.yaw
          : dampAngle(L.cam.heading, a.yaw, 0.5 * Math.max(1, L.clock.speed ** 0.5), dt);
        pose = heliPose(fx, fy, L.cam.heading, spread);
        key = "heli";
        lambda = 0;
      }
    } else {
      const a = L.samples[focusIdx]!;
      if (L.mode === "chase") {
        L.cam.heading = L.cam.init && L.cam.key === "chase" ? dampAngle(L.cam.heading, a.yaw, 6, dt) : a.yaw;
        pose = chasePose(a, L.cam.heading);
        lambda = 0;
      } else if (L.mode === "onboard") {
        pose = onboardPose(a);
      } else {
        const wide = size.width > 760;
        pose = mapPose(model.bounds, size.width, size.height, {
          left: wide ? 372 : 16,
          right: wide ? 24 : 16,
          top: wide ? 24 : 150,
          bottom: wide ? 76 : 90,
        });
      }
    }

    if (L.mode !== "map") pose = { ...pose, fov: fitFov(pose.fov, size.width / Math.max(1, size.height)) };
    const cut = !L.cam.init || key !== L.cam.key;
    if (cut || lambda === 0) {
      L.cam.pos = pose.pos;
      L.cam.look = pose.look;
      L.cam.fov = pose.fov;
    } else {
      L.cam.pos = key.startsWith("ts") ? pose.pos : damp3(L.cam.pos, pose.pos, lambda, dt);
      L.cam.look = damp3(L.cam.look, pose.look, lambda, dt);
      L.cam.fov = damp(L.cam.fov, pose.fov, 6, dt);
    }
    L.cam.init = true;
    L.cam.key = key;
    cam.position.set(...L.cam.pos);
    cam.up.copy(L.mode === "map" ? MAP_UP : UP);
    cam.lookAt(...(L.cam.look as Vec3));
    if (Math.abs(cam.fov - L.cam.fov) > 1e-3) {
      cam.fov = L.cam.fov;
      cam.updateProjectionMatrix();
    }
    cam.near = L.mode === "onboard" ? 0.3 : L.mode === "map" ? 5 : 0.5;
    cam.far = 9000;
    cam.updateProjectionMatrix();

    const light = lightRef.current;
    if (light) {
      const f = L.mode === "map" ? L.cam.look : toLook(L.samples[focusIdx]!);
      const snap = 4;
      const tx = Math.round(f[0] / snap) * snap;
      const tz = Math.round(f[2] / snap) * snap;
      light.target.position.set(tx, 0, tz);
      light.position.set(tx + SUN_DIR.x * 400, SUN_DIR.y * 400, tz + SUN_DIR.z * 400);
      if (!light.target.parent) scene.add(light.target);
      light.target.updateMatrixWorld();
    }

    const half = { w: size.width / 2, h: size.height / 2 };
    const boxes: LabelBox[] = [];
    const shown: number[] = [];
    model.cars.forEach((_, k) => {
      const el = L.labels[k];
      if (!el) return;
      const s = L.samples[k]!;
      tmp.v.set(s.x, mapMode ? 4 : 2.1, -s.y);
      const d = cam.position.distanceTo(tmp.v);
      tmp.v.project(cam);
      const hidden =
        tmp.v.z > 1 ||
        Math.abs(tmp.v.x) > 1.1 ||
        Math.abs(tmp.v.y) > 1.1 ||
        ((L.mode === "onboard" || L.mode === "chase") && k === focusIdx) ||
        (!mapMode && d > 900);
      el.style.display = hidden ? "none" : "";
      if (hidden) return;
      const x = tmp.v.x * half.w + half.w;
      const y = -tmp.v.y * half.h + half.h;
      boxes.push({ x, y: y - 6, w: el.offsetWidth || 120, h: el.offsetHeight || 20, priority: -d });
      shown.push(k);
      el.style.zIndex = String(10000 - Math.min(9999, Math.round(d)));
    });
    const offs = stackLabels(boxes);
    shown.forEach((k, n) => {
      const b = boxes[n]!;
      L.labels[k]!.style.transform = `translate(${b.x.toFixed(1)}px, ${(b.y + offs[n]!).toFixed(1)}px)`;
    });

    const fps = L.fps;
    fps.frames++;
    fps.acc += dt;
    fps.jsAcc += performance.now() - t0;
    if (fps.acc >= 1) {
      fps.avgMs = (fps.acc / fps.frames) * 1000;
      fps.jsMs = fps.jsAcc / fps.frames;
      fps.jsAcc = 0;
      fps.calls = gl.info.render.calls;
      fps.tris = gl.info.render.triangles;
      (window as unknown as { __viewerStats: unknown }).__viewerStats = {
        fps: 1000 / fps.avgMs,
        frameMs: fps.avgMs,
        loopMs: fps.jsMs,
        drawCalls: fps.calls,
        triangles: fps.tris,
      };
      fps.frames = 0;
      fps.acc = 0;
      if (import.meta.env.DEV && wall - fps.lastLog > 5) {
        fps.lastLog = wall;
        console.info(
          `[viewer] avg frame ${fps.avgMs.toFixed(2)} ms (${(1000 / fps.avgMs).toFixed(0)} fps), loop ${fps.jsMs.toFixed(2)} ms, ${fps.calls} draw calls`,
        );
      }
    }
  });
  return null;
}

function toLook(s: { x: number; y: number }): Vec3 {
  return [s.x, 0, -s.y];
}
