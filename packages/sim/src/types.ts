// Public driver API types. Mirrored (by hand, checked by a test) in ddk/driver.d.ts.

export type Surface = "track" | "kerb" | "grass" | "gravel";
export type SurfaceOrBarrier = Surface | "barrier";

export interface TrackSample {
  s: number;
  x: number;
  y: number;
  heading: number;
  curvature: number;
  widthLeft: number;
  widthRight: number;
}

export interface TrackInfo {
  apiVersion: string;
  id: string;
  length: number;
  sampleSpacing: number;
  samples: TrackSample[];
  sectors: number[];
}

export interface CarSpec {
  infoLevel: "A" | "B";
  mass: number;
  wheelbase: number;
  width: number;
  length: number;
  weightFront: number;
  maxSteer: number;
  steerRate: number;
  throttleRate: number;
  brakeRate: number;
  maxPower: number;
  /** Only present at information level A. */
  hidden?: CarHidden;
}

export interface Telemetry {
  t: number;
  lap: number;
  lapTime: number;
  sector: number;
  s: number;
  n: number;
  headingError: number;
  x: number;
  y: number;
  yaw: number;
  speed: number;
  vx: number;
  vy: number;
  yawRate: number;
  ax: number;
  ay: number;
  steer: number;
  throttle: number;
  brake: number;
  surface: Surface;
  offTrackWarnings: number;
}

export interface Controls {
  throttle: number;
  brake: number;
  steer: number;
}

/** What the sim needs from a driver. Implementations: plain module import, QuickJS sandbox. */
export interface DriverRuntime {
  init(track: TrackInfo, car: CarSpec): void;
  step(t: Telemetry): unknown;
  dispose?(): void;
}

// ---- car configuration -------------------------------------------------------------------------

export interface TireParams {
  /** Pacejka stiffness factor B (1/rad). */
  B: number;
  /** Pacejka shape factor C. */
  C: number;
  /** Peak friction coefficient at nominal load. */
  mu: number;
}

export interface CarHidden {
  cgHeight: number;
  yawInertia: number;
  CdA: number;
  ClA: number;
  aeroBalanceFront: number;
  airDensity: number;
  tireFront: TireParams;
  tireRear: TireParams;
  /** mu(Fz) = mu * (1 - loadSensitivity * (Fz / Fz_static - 1)). */
  loadSensitivity: number;
  /** Fraction of peak friction available while the axle is sliding (lock-up / wheelspin). */
  slidingFriction: number;
  maxBrakeForce: number;
  brakeBiasFront: number;
  maxDriveForce: number;
  rollingResistance: number;
}

export interface CarConfig {
  id: string;
  version: number;
  public: Omit<CarSpec, "infoLevel" | "hidden">;
  hidden: CarHidden;
}

// ---- track file ----------------------------------------------------------------------------------

export interface RunoffSpec {
  type: "grass" | "gravel";
  width: number;
}

export interface RunoffZone extends RunoffSpec {
  /** Fractions of the lap length (0..1); a zone may wrap past the line (from > to). */
  from: number;
  to: number;
  side: "left" | "right" | "both";
}

export interface TrackFile {
  id: string;
  name: string;
  version: number;
  closed: true;
  /** [x, y, widthRight, widthLeft] in meters. */
  points: [number, number, number, number][];
  /** Where sectors 1 and 2 end, as fractions of the lap length (0..1). */
  sectors: [number, number];
  runoff: { default: RunoffSpec; zones?: RunoffZone[] };
  /** Optional: reverse the driving direction of the point list. */
  reverse?: boolean;
  license?: string;
  source?: string;
}
