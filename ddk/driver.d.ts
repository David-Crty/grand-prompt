// Driver API, apiVersion 0.1. A driver is one ES module exporting init() and step().
// Units: SI everywhere (m, s, kg, rad, N, W). World plane is x/y, angles counter-clockwise from +x.

/** Called once before the session starts. Precompute here (racing line, speed profile...). */
export declare function init(track: TrackInfo, car: CarSpec): void;

/** Called at 50 Hz (every 20 ms of simulated time). Must return quickly. */
export declare function step(t: Telemetry): Controls;

/** Global helper, captured in practice runs only (log.txt). Rate limited. No-op in races. */
export declare function log(...values: unknown[]): void;

export interface TrackInfo {
  apiVersion: string;
  id: string;
  /** Lap length along the centerline, m. */
  length: number;
  /** Distance between consecutive samples, m (about 2). */
  sampleSpacing: number;
  /** Closed loop: the sample after the last one is samples[0]. samples[i].s = i * sampleSpacing. */
  samples: TrackSample[];
  /** s (m) where sector 1 and sector 2 end. The start/finish line is at s = 0. */
  sectors: number[];
}

export interface TrackSample {
  /** Distance along the centerline from the start/finish line, m. */
  s: number;
  /** Centerline position, m. */
  x: number;
  y: number;
  /** Direction of travel, rad. */
  heading: number;
  /** Centerline curvature, 1/m. Positive = turning left. */
  curvature: number;
  /** Distance from the centerline to the left/right track edge (white line), m. */
  widthLeft: number;
  widthRight: number;
}

export interface CarSpec {
  /** "B": tire and aero constants are hidden (infer them from practice). "A": `hidden` is present. */
  infoLevel: "A" | "B";
  /** Car + driver, kg. */
  mass: number;
  /** m */
  wheelbase: number;
  /** m */
  width: number;
  /** m */
  length: number;
  /** Static fraction of weight on the front axle. */
  weightFront: number;
  /** Maximum road-wheel steering angle, rad. steer = 1 means +maxSteer. */
  maxSteer: number;
  /** Maximum steering rate at the wheels, rad/s. */
  steerRate: number;
  /** Maximum throttle change per second (fraction/s). */
  throttleRate: number;
  /** Maximum brake change per second (fraction/s). */
  brakeRate: number;
  /** Peak engine power, W. */
  maxPower: number;
  /** Information level A only. */
  hidden?: Record<string, unknown>;
}

export interface Telemetry {
  /** Session time, s. The run-up takes the first 3 s, so your first step is at t = 3. */
  t: number;
  /** Always 1: a session is one flying lap. */
  lap: number;
  /** Time since the car crossed the line, s (0 at your first step). */
  lapTime: number;
  /** 1, 2 or 3. */
  sector: number;
  /** Frenet coordinates: distance along the centerline (0..length) and lateral offset (m, positive = left). */
  s: number;
  n: number;
  /** Car yaw minus centerline heading at s, rad, wrapped to (-pi, pi]. */
  headingError: number;
  /** World position of the car's centre of mass and yaw, rad. */
  x: number;
  y: number;
  yaw: number;
  /** m/s */
  speed: number;
  /** Body-frame velocity: vx forward, vy to the left, m/s. */
  vx: number;
  vy: number;
  /** rad/s, positive = turning left */
  yawRate: number;
  /** Body-frame acceleration (accelerometer): ax forward, ay to the left, m/s^2. */
  ax: number;
  ay: number;
  /** Actual actuator positions (they lag your commands, see the rate limits in CarSpec). */
  steer: number;
  throttle: number;
  brake: number;
  /** Surface under the car's centre. */
  surface: "track" | "kerb" | "grass" | "gravel";
  /** Times the car has left the track so far. Any one of them deletes the lap. */
  offTrackWarnings: number;
}

export interface Controls {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1, fraction of maxSteer, positive = left */
  steer: number;
}
