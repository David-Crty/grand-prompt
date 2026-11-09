import type * as THREE from "three";
import type { Vec3 } from "../lib/coords.js";
import type { Shot } from "../lib/director.js";
import type { CarSample } from "../lib/frames.js";
import type { CameraMode } from "../lib/params.js";
import type { PlaybackClock } from "../lib/playback.js";
import type { StandingRow } from "../lib/timing.js";

export interface CarHandles {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  steer: THREE.Object3D[];
  marker: THREE.Object3D;
  trail: THREE.Mesh;
}

/** Mutable per-frame state shared by the render loop and the HUD (which polls it). */
export interface LiveState {
  clock: PlaybackClock;
  mode: CameraMode;
  focusId: string;
  /** The viewer picked the car; the TV director follows it instead of choosing. */
  manualFocus: boolean;
  trails: boolean;
  shot: Shot | null;
  rows: StandingRow[];
  samples: CarSample[];
  cars: (CarHandles | null)[];
  labels: (HTMLDivElement | null)[];
  cam: {
    pos: Vec3;
    look: Vec3;
    fov: number;
    heading: number;
    init: boolean;
    key: string;
    /** Heli framing target ("primary|secondary") and the one it is blending away from. */
    focusKey: string;
    fromKey: string;
    blendStart: number;
  };
  wheelSpin: number[];
  fps: {
    frames: number;
    acc: number;
    avgMs: number;
    lastLog: number;
    jsAcc: number;
    jsMs: number;
    calls: number;
    tris: number;
  };
}
