import type * as THREE from "three";
import type { Vec3 } from "../lib/coords.js";
import type { CarSample } from "../lib/frames.js";
import type { Pack } from "../lib/pack.js";
import type { CameraMode } from "../lib/params.js";
import type { PlaybackClock } from "../lib/playback.js";
import type { StandingRow } from "../lib/timing.js";

export interface CarHandles {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  steer: THREE.Object3D[];
  wheelRadius: number;
  marker: THREE.Object3D;
  trail: THREE.Mesh;
}

/** Mutable per-frame state shared by the render loop and the HUD (which polls it). */
export interface LiveState {
  clock: PlaybackClock;
  mode: CameraMode;
  focusId: string;
  trails: boolean;
  /** TV zoom factor: both framing spans are divided by it. */
  tvZoom: number;
  /** TV camera tilt, degrees off the vertical. */
  tvTilt: number;
  rows: StandingRow[];
  samples: CarSample[];
  cars: (CarHandles | null)[];
  labels: (HTMLDivElement | null)[];
  /** The pack of overlapping cars drawn with a single label this frame. */
  labelPack: (Pack & { others: string[] }) | null;
  packLabel: HTMLDivElement | null;
  /** Height (px) of a bottom sheet the TV camera should frame the car above, or null. */
  insetBottom: number | null;
  cam: {
    pos: Vec3;
    look: Vec3;
    fov: number;
    heading: number;
    init: boolean;
    key: string;
    /** TV framing: where the frame centre sits relative to the focused car, and its width (m). */
    offset: [number, number];
    span: number;
    framed: string[];
    wait: Record<string, number>;
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
