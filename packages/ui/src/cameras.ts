/** The viewer's cameras, in the order of their keys (1 to 4). */
export const CAMERA_MODES = ["tv", "chase", "onboard", "map"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_LABEL: Record<CameraMode, string> = {
  tv: "TV",
  chase: "Chase",
  onboard: "Onboard",
  map: "Map",
};
