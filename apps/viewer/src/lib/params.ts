import { CAMERA_MODES, type CameraMode } from "@bench/ui";
import { TV_TILT } from "./camera.js";

export { CAMERA_MODES, type CameraMode };
/** Playback speeds; below 1x is slow motion (incident replays start at 0.5x). */
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;

export interface ViewerParams {
  t: number | null;
  cam: CameraMode | null;
  car: string | null;
  speed: number | null;
  play: boolean | null;
  hud: boolean;
  trails: boolean;
  analysis: boolean;
  fps: boolean;
  /** TV zoom factor, or null for the default. */
  zoom: number | null;
  /** TV camera tilt (degrees off the vertical), or null for the default. */
  tilt: number | null;
}

function flag(v: string | null): boolean | null {
  if (v === null) return null;
  return v === "" || v === "1" || v === "true" || v === "yes";
}

export function parseParams(search: string): ViewerParams {
  const q = new URLSearchParams(search);
  const num = (k: string) => {
    const v = q.get(k);
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const camRaw = q.get("cam");
  const cam = CAMERA_MODES.find((m) => m === camRaw) ?? null;
  const speed = num("speed");
  const zoom = num("zoom");
  const tilt = num("tilt");
  return {
    t: num("t"),
    cam,
    car: q.get("car"),
    speed: speed !== null && speed > 0 ? speed : null,
    play: flag(q.get("play")),
    hud: flag(q.get("hud")) ?? true,
    trails: flag(q.get("trails")) ?? true,
    analysis: flag(q.get("analysis")) ?? false,
    fps: flag(q.get("fps")) ?? false,
    zoom: zoom !== null && zoom > 0 ? zoom : null,
    tilt,
  };
}

/** Next/previous entry of SPEEDS from the current speed. */
export function stepSpeed(current: number, dir: 1 | -1): number {
  if (dir > 0) return SPEEDS.find((s) => s > current + 1e-9) ?? SPEEDS[SPEEDS.length - 1]!;
  return [...SPEEDS].reverse().find((s) => s < current - 1e-9) ?? SPEEDS[0];
}

/** The camera a viewer leaves in, to carry into another replay. */
export interface CameraView {
  cam: CameraMode;
  zoom: number;
  tilt: number;
}

/**
 * The query for another event's replay on the same circuit: it starts from the top, with the same camera and the
 * same view options. Defaults stay out of the address.
 */
export function restartSearch(search: string, view: CameraView): string {
  const q = new URLSearchParams(search);
  for (const k of ["t", "car", "play", "cam", "zoom", "tilt"]) q.delete(k);
  if (view.cam !== "tv") q.set("cam", view.cam);
  if (view.zoom !== 1) q.set("zoom", String(Math.round(view.zoom * 1000) / 1000));
  if (view.tilt !== TV_TILT) q.set("tilt", String(Math.round(view.tilt * 10) / 10));
  const out = q.toString();
  return out ? `?${out}` : "";
}
