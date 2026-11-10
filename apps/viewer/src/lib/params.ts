import { CAMERA_MODES, type CameraMode } from "@bench/ui";

export { CAMERA_MODES, type CameraMode };
/** Playback speeds; below 1x is slow motion (incident replays start at 0.5x). */
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;

export interface ViewerParams {
  replay: string | null;
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
  return {
    replay: q.get("replay"),
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
  };
}

/** Next/previous entry of SPEEDS from the current speed. */
export function stepSpeed(current: number, dir: 1 | -1): number {
  if (dir > 0) return SPEEDS.find((s) => s > current + 1e-9) ?? SPEEDS[SPEEDS.length - 1]!;
  return [...SPEEDS].reverse().find((s) => s < current - 1e-9) ?? SPEEDS[0];
}

/**
 * Deep-link time, camera and car belong to the replay named in the URL. A replay dropped onto the page
 * opens at the start, followed car and camera reset.
 */
export function paramsForReplay(p: ViewerParams, fromUrl: boolean): ViewerParams {
  return fromUrl ? p : { ...p, t: null, cam: null, car: null };
}
