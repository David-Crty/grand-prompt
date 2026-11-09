import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import {
  chasePose,
  fitFov,
  type Insets,
  mapPose,
  onboardPose,
  type Pose,
  TV_MAX_SPAN,
  TV_MIN_SPAN,
  tvFrame,
  tvPose,
} from "../lib/camera.js";
import { damp, dampAngle, type Vec3 } from "../lib/coords.js";
import { sampleCar } from "../lib/frames.js";
import { type LabelBox, stackLabels } from "../lib/labels.js";
import type { ViewerModel } from "../lib/model.js";
import { carPlacement, findPacks, ghostIds, labelPack, PACK_LENGTHS } from "../lib/pack.js";
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
    L.rows = liveStandings(model.cars, t);
    const mapMode = L.mode === "map";
    // Overlapping runs are drawn translucent and labelled as one pack; positions are never touched.
    const packs = findPacks(
      model.cars.map((c, k) => {
        const s = L.samples[k]!;
        return { id: c.car.id, x: s.x, y: s.y, progress: s.progress, ended: s.ended };
      }),
      PACK_LENGTHS * model.replay.header.car.length,
    );
    const ghosts = ghostIds(packs, L.focusId);
    L.labelPack = mapMode ? null : labelPack(packs, L.focusId);

    model.cars.forEach((c, k) => {
      const h = L.cars[k];
      const s = L.samples[k]!;
      if (!h) return;
      const at = carPlacement(s);
      h.group.position.set(...at.position);
      h.group.rotation.y = at.yaw;
      h.setGhost(ghosts.has(c.car.id));
      for (const p of h.steer) p.rotation.y = s.steer * maxSteer;
      const spin =
        (L.wheelSpin[k] ?? 0) -
        (s.ended ? 0 : (s.speed * dt * L.clock.speed * (L.clock.playing ? 1 : 0)) / h.wheelRadius);
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

    const focusIdx = idOf.get(L.focusId) ?? 0;
    let pose: Pose;
    if (L.mode === "tv") {
      const a = L.samples[focusIdx]!;
      const insets = hudInsets(size.width, L.insetBottom);
      const aspect =
        Math.max(50, size.width - insets.left - insets.right) /
        Math.max(50, size.height - insets.top - insets.bottom);
      const fresh = !L.cam.init || L.cam.key !== "tv";
      const rate = Math.max(1, L.clock.speed ** 0.5);
      L.cam.heading = fresh ? a.yaw : dampAngle(L.cam.heading, a.yaw, 0.5 * rate, dt);
      const others = model.cars.flatMap((c, k) => {
        const o = L.samples[k]!;
        return k === focusIdx || o.ended ? [] : [{ id: c.car.id, x: o.x, y: o.y }];
      });
      const prevFocus = L.cam.framed[0];
      const frame = tvFrame(
        { id: L.focusId, x: a.x, y: a.y },
        others,
        L.cam.heading,
        aspect,
        L.cam.framed,
        TV_MAX_SPAN / L.tvZoom,
        TV_MIN_SPAN / L.tvZoom,
      );
      const target: [number, number] = [frame.x - a.x, frame.y - a.y];
      if (fresh) {
        L.cam.offset = target;
        L.cam.span = frame.span;
      } else {
        if (prevFocus !== undefined && prevFocus !== L.focusId) {
          const p = L.samples[idOf.get(prevFocus) ?? focusIdx]!;
          L.cam.offset = [p.x + L.cam.offset[0] - a.x, p.y + L.cam.offset[1] - a.y];
        }
        L.cam.offset = [
          damp(L.cam.offset[0], target[0], 2.5 * rate, dt),
          damp(L.cam.offset[1], target[1], 2.5 * rate, dt),
        ];
        L.cam.span = damp(L.cam.span, frame.span, 2.2 * rate, dt);
      }
      L.cam.framed = frame.ids;
      pose = tvPose(
        { x: a.x + L.cam.offset[0], y: a.y + L.cam.offset[1], span: L.cam.span },
        L.cam.heading,
        size.width,
        size.height,
        insets,
      );
    } else {
      const a = L.samples[focusIdx]!;
      if (L.mode === "chase") {
        L.cam.heading = L.cam.init && L.cam.key === "chase" ? dampAngle(L.cam.heading, a.yaw, 6, dt) : a.yaw;
        pose = chasePose(a, L.cam.heading);
      } else if (L.mode === "onboard") {
        pose = onboardPose(a);
      } else {
        pose = mapPose(model.bounds, size.width, size.height, hudInsets(size.width, L.insetBottom));
      }
    }

    if (L.mode === "chase" || L.mode === "onboard")
      pose = { ...pose, fov: fitFov(pose.fov, size.width / Math.max(1, size.height)) };
    L.cam.pos = pose.pos;
    L.cam.look = pose.look;
    L.cam.fov = pose.fov;
    L.cam.init = true;
    L.cam.key = L.mode;
    cam.position.set(...L.cam.pos);
    if (pose.up) cam.up.set(...pose.up);
    else cam.up.copy(L.mode === "map" ? MAP_UP : UP);
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
      const f = L.mode === "map" || L.mode === "tv" ? L.cam.look : toLook(L.samples[focusIdx]!);
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
    const shown: HTMLDivElement[] = [];
    const inPack = new Set(L.labelPack?.others ?? []);
    const place = (el: HTMLDivElement, x: number, y: number, d: number) => {
      const tag = el.querySelector<HTMLElement>(".gp-clabel, .gp-pack, .gp-pin") ?? el;
      boxes.push({ x, y: y - 6, w: tag.offsetWidth || 120, h: tag.offsetHeight || 20, priority: -d });
      shown.push(el);
      el.style.zIndex = String(10000 - Math.min(9999, Math.round(d)));
    };
    const pl = L.packLabel;
    if (pl) {
      const members = L.labelPack
        ? model.cars.flatMap((c, k) => (inPack.has(c.car.id) ? [L.samples[k]!] : []))
        : [];
      let visible = members.length > 0;
      if (visible) {
        const cx = members.reduce((a, m) => a + m.x, 0) / members.length;
        const cy = members.reduce((a, m) => a + m.y, 0) / members.length;
        tmp.v.set(cx, 2.6, -cy);
        const d = cam.position.distanceTo(tmp.v);
        tmp.v.project(cam);
        visible = tmp.v.z <= 1 && Math.abs(tmp.v.x) <= 1.1 && Math.abs(tmp.v.y) <= 1.1;
        if (visible) place(pl, tmp.v.x * half.w + half.w, -tmp.v.y * half.h + half.h, d);
      }
      pl.style.display = visible ? "" : "none";
    }
    model.cars.forEach((c, k) => {
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
        inPack.has(c.car.id) ||
        (!mapMode && d > 900);
      el.style.display = hidden ? "none" : "";
      if (hidden) return;
      place(el, tmp.v.x * half.w + half.w, -tmp.v.y * half.h + half.h, d);
    });
    const offs = stackLabels(boxes);
    shown.forEach((el, n) => {
      const b = boxes[n]!;
      el.style.transform = `translate(${b.x.toFixed(1)}px, ${(b.y + offs[n]!).toFixed(1)}px)`;
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

/** Screen space the HUD covers, so the TV and map cameras frame cars in what is left. */
function hudInsets(width: number, sheet: number | null): Insets {
  if (width < 600) return { left: 12, right: 12, top: 170, bottom: sheet ?? 200 };
  const wide = width > 760;
  return { left: wide ? 372 : 16, right: wide ? 24 : 16, top: wide ? 24 : 150, bottom: wide ? 76 : 90 };
}

function toLook(s: { x: number; y: number }): Vec3 {
  return [s.x, 0, -s.y];
}
