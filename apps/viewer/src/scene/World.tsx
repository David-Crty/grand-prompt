import { Sky } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ViewerModel } from "../lib/model.js";
import {
  buildBarriers,
  buildGantry,
  buildGrandstands,
  buildLines,
  buildSurface,
  pointAt,
} from "../lib/track.js";
import { fromBuilder } from "./geometry.js";

export const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.55).normalize();

function noiseTexture(
  size: number,
  base: [number, number, number],
  amp: number,
  seed: number,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let k = 0; k < size * size; k++) {
    const f = 1 + (rnd() - 0.5) * amp;
    img.data[k * 4] = Math.min(255, base[0] * f);
    img.data[k * 4 + 1] = Math.min(255, base[1] * f);
    img.data[k * 4 + 2] = Math.min(255, base[2] * f);
    img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function labelTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = fg;
  ctx.font = "bold 54px 'Nimbus Sans Narrow', 'Arial Narrow', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Ground({ model }: { model: ViewerModel }) {
  const tex = useMemo(() => {
    const t = noiseTexture(128, [88, 132, 58], 0.14, 11);
    t.repeat.set(220, 220);
    return t;
  }, []);
  const b = model.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[cx, -0.08, -cy]} receiveShadow>
      <planeGeometry args={[9000, 9000, 90, 90]} />
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
}

function Hills({ model }: { model: ViewerModel }) {
  const geo = useMemo(() => {
    const b = model.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const r0 = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2 + 1500;
    const seg = 96;
    const rings = [r0, r0 + 500, r0 + 1100, r0 + 1800];
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const near = new THREE.Color("#5f8f4a");
    const far = new THREE.Color("#8fae9c");
    for (let r = 0; r < rings.length; r++) {
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const n = Math.sin(a * 3 + r) * 0.5 + Math.sin(a * 7 + 1.3 * r) * 0.3 + Math.sin(a * 13 + 0.7) * 0.2;
        const h = r === 0 ? -2 : r === rings.length - 1 ? 40 : 60 + (n + 1) * (r === 1 ? 70 : 140);
        pos.push(cx + Math.cos(a) * rings[r]!, h, -(cy + Math.sin(a) * rings[r]!));
        const c = near.clone().lerp(far, r / (rings.length - 1));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < seg; k++) {
        const a = r * seg + k;
        const b2 = r * seg + ((k + 1) % seg);
        const c = (r + 1) * seg + k;
        const d = (r + 1) * seg + ((k + 1) % seg);
        idx.push(a, c, b2, b2, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const flat = g.toNonIndexed();
    flat.computeVertexNormals();
    return flat;
  }, [model]);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial vertexColors roughness={1} flatShading side={THREE.DoubleSide} />
    </mesh>
  );
}

function TrackMeshes({ model }: { model: ViewerModel }) {
  const geos = useMemo(() => {
    const L = model.layout;
    return {
      surface: fromBuilder(buildSurface(L)),
      lines: fromBuilder(buildLines(L, model.replay.track.sectors)),
      barriers: fromBuilder(buildBarriers(L)),
      gantry: fromBuilder(buildGantry(L, 25)),
      stands: fromBuilder(buildGrandstands(model.grandstands)),
    };
  }, [model]);
  useLayoutEffect(
    () => () => {
      for (const g of Object.values(geos)) g.dispose();
    },
    [geos],
  );
  return (
    <group>
      <mesh geometry={geos.surface} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} />
      </mesh>
      <mesh geometry={geos.lines} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.8} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      <mesh geometry={geos.barriers} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geos.gantry} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh geometry={geos.stands} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.85} />
      </mesh>
    </group>
  );
}

function SectorBoards({ model }: { model: ViewerModel }) {
  const items = useMemo(() => {
    const L = model.layout;
    const list = [
      { s: 0, text: "FINISH", bg: "#111", fg: "#fff" },
      ...model.replay.track.sectors.map((s, k) => ({ s, text: `S${k + 2}`, bg: "#f5c400", fg: "#111" })),
    ];
    return list.map((it) => {
      const p = pointAt(L, it.s);
      const off = -(p.barrierR + 1.6);
      return {
        ...it,
        pos: [p.x + p.nx * off, 0, -(p.y + p.ny * off)] as [number, number, number],
        rotY: p.heading - Math.PI / 2,
        tex: labelTexture(it.text, it.bg, it.fg),
      };
    });
  }, [model]);
  return (
    <group>
      {items.map((it) => (
        <group key={it.text} position={it.pos} rotation-y={it.rotY}>
          <mesh position={[0, 2.8, 0]} castShadow>
            <boxGeometry args={[2.6, 1.0, 0.12]} />
            <meshStandardMaterial attach="material-4" map={it.tex} />
            <meshStandardMaterial attach="material-5" map={it.tex} />
            <meshStandardMaterial attach="material-0" color="#333" />
            <meshStandardMaterial attach="material-1" color="#333" />
            <meshStandardMaterial attach="material-2" color="#333" />
            <meshStandardMaterial attach="material-3" color="#333" />
          </mesh>
          <mesh position={[0, 1.15, 0]}>
            <boxGeometry args={[0.15, 2.3, 0.15]} />
            <meshStandardMaterial color="#555" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Trees({ model }: { model: ViewerModel }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const pines = useRef<THREE.InstancedMesh>(null);
  const leafy = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const trunk = new THREE.CylinderGeometry(0.22, 0.35, 3, 5).translate(0, 1.5, 0);
    const pine = new THREE.ConeGeometry(2.6, 8, 7).translate(0, 6.5, 0);
    const blob = new THREE.IcosahedronGeometry(3.4, 0).translate(0, 5.6, 0);
    return { trunk, pine, blob };
  }, []);
  const split = useMemo(() => {
    const p = model.trees.filter((t) => t.variant === 0);
    const l = model.trees.filter((t) => t.variant !== 0);
    return { p, l };
  }, [model]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const set = (mesh: THREE.InstancedMesh | null, list: typeof model.trees, greens: string[]) => {
      if (!mesh) return;
      list.forEach((t, k) => {
        q.setFromAxisAngle(up, t.heading);
        const s = t.scale;
        m.compose(new THREE.Vector3(t.x, 0, -t.y), q, new THREE.Vector3(s, s * (0.85 + (k % 5) * 0.08), s));
        mesh.setMatrixAt(k, m);
        if (greens.length) mesh.setColorAt(k, col.set(greens[k % greens.length]!));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
    set(trunks.current, model.trees, ["#6b4a2f", "#5a3d26"]);
    set(pines.current, split.p, ["#2f5d34", "#3a6b3a", "#28502d"]);
    set(leafy.current, split.l, ["#4f8a3a", "#5e9940", "#447a33", "#6aa348", "#3d7030"]);
  }, [model, split]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[geo.trunk, undefined, model.trees.length]} castShadow>
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh ref={pines} args={[geo.pine, undefined, split.p.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
      <instancedMesh ref={leafy} args={[geo.blob, undefined, split.l.length]} castShadow receiveShadow>
        <meshStandardMaterial roughness={0.9} flatShading />
      </instancedMesh>
    </group>
  );
}

export function World({
  model,
  lightRef,
}: {
  model: ViewerModel;
  lightRef: React.RefObject<THREE.DirectionalLight | null>;
}) {
  const sun = useMemo(() => SUN_DIR.clone().multiplyScalar(1000), []);
  return (
    <>
      <color attach="background" args={["#bcd3e6"]} />
      <fog attach="fog" args={["#c9dcea", 900, 5200]} />
      <Sky
        distance={45000}
        sunPosition={[sun.x, sun.y, sun.z]}
        turbidity={2.5}
        rayleigh={1.6}
        mieCoefficient={0.003}
        mieDirectionalG={0.85}
      />
      <hemisphereLight args={["#dbe9ff", "#5d7a3a", 1.1]} />
      <directionalLight
        ref={lightRef}
        intensity={2.6}
        color="#fff4e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-camera-near={1}
        shadow-camera-far={900}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      <Ground model={model} />
      <Hills model={model} />
      <TrackMeshes model={model} />
      <SectorBoards model={model} />
      <Trees model={model} />
    </>
  );
}
