import { clamp, Hasher, loopDelta, wrapAngle, wrapS } from "./math.js";
import type { Track } from "./track/track.js";
import type { CarConfig, Controls, DriverRuntime, Surface, SurfaceOrBarrier, Telemetry } from "./types.js";
import { carSpec, initialState, SURFACES, speedOf, VehicleModel, type VehicleState } from "./vehicle.js";

export const CONTROL_HZ = 50;
export const PHYSICS_SUBSTEPS = 10;
export const CONTROL_DT = 1 / CONTROL_HZ;
export const PHYSICS_DT = CONTROL_DT / PHYSICS_SUBSTEPS;

export const MAX_STRIKES = 3;
export const STALL_SPEED = 1;
export const STALL_TIME = 10;
export const CRASH_SPEED = 12;
const LIMIT_HYSTERESIS = 0.3;

/** Seconds of run-up before the line: the car is placed on the centreline, the driver takes over at s = 0. */
export const LAUNCH_TIME = 3;
export const LAUNCH_TICKS = LAUNCH_TIME * CONTROL_HZ;
export const LAUNCH_MAX_SPEED = 250 / 3.6;
/** The run-up accelerates steadily at this rate (m/s²) onto the line. */
export const LAUNCH_ACCEL = 6;
/** Lateral acceleration (m/s²) the run-up and the first second after the line are held to. */
export const LAUNCH_LATERAL = 15;
/** Seconds allowed for the lap once the car is over the line. */
export const LAP_TIME_LIMIT = 300;
export type CarStatus =
  | "RUNNING"
  | "FINISHED"
  | "DNF: CRASHED"
  | "DNF: STALLED"
  | "DNF: ECU FAILURE"
  | "TIME UP";

export const SURFACE_CODES: SurfaceOrBarrier[] = ["track", "kerb", "grass", "gravel", "barrier"];

/** Every session is one flying lap: a run-up of LAUNCH_TIME seconds, then one timed lap from the line. */
export interface SessionConfig {
  seed: number;
  /** Seconds the car may run after the line before TIME UP (default LAP_TIME_LIMIT). */
  timeLimit?: number;
  recordTelemetry?: boolean;
}

export interface LapRecord {
  lap: number;
  time: number;
  sectors: number[];
  valid: boolean;
}

export type EventType = "lap" | "sector" | "offTrack" | "impact" | "crash" | "strike" | "status";

export interface SimEvent {
  t: number;
  type: EventType;
  lap: number;
  value?: number;
  detail?: string;
}

export interface CarResult {
  id: string;
  name: string;
  status: CarStatus;
  /** The completed lap, valid or not. */
  lap: LapRecord | null;
  /** The score: the lap time if the lap was completed and valid, else null. */
  lapTime: number | null;
  offTracks: number;
  strikes: number;
  maxSpeed: number;
  distance: number;
  stateHash: string;
  errors: string[];
}

/** Columnar 50 Hz frames. t = i / CONTROL_HZ. */
export interface CarFrames {
  x: number[];
  y: number[];
  yaw: number[];
  speed: number[];
  steer: number[];
  throttle: number[];
  brake: number[];
  surface: number[];
  lap: number[];
  s: number[];
}

export interface TelemetryLog {
  t: number[];
  s: number[];
  n: number[];
  speed: number[];
  throttle: number[];
  brake: number[];
  steer: number[];
  ax: number[];
  ay: number[];
  surface: Surface[];
}

export interface CarRun {
  result: CarResult;
  frames: CarFrames;
  events: SimEvent[];
  telemetry?: TelemetryLog;
}

export interface CarEntry {
  id: string;
  name: string;
  runtime: DriverRuntime;
}

/** Run-up position (m, negative before the line) and speed `before` seconds ahead of the line. */
export function launchPoint(v0: number, before: number): { s: number; v: number } {
  return { s: -(v0 * before - (LAUNCH_ACCEL * before * before) / 2), v: v0 - LAUNCH_ACCEL * before };
}

/**
 * Speed at which every car crosses the line: the largest speed, capped at LAUNCH_MAX_SPEED, for which
 * the run-up and the first second after the line stay within LAUNCH_LATERAL.
 */
export function launchSpeed(track: Track): number {
  const fits = (s: number, v: number) =>
    v * v * Math.abs(track.curvature[track.indexAt(s)]!) <= LAUNCH_LATERAL;
  const ok = (v0: number) => {
    for (let i = 0; i <= LAUNCH_TICKS; i++) {
      const p = launchPoint(v0, i * CONTROL_DT);
      if (!fits(p.s, p.v)) return false;
    }
    for (let s = 0; s <= v0; s += track.spacing) if (!fits(s, v0)) return false;
    return true;
  };
  let v = LAUNCH_MAX_SPEED;
  while (v > LAUNCH_ACCEL * LAUNCH_TIME && !ok(v)) v -= 0.25;
  return v;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** One car, alone on track (ghost mode). */
export class CarSim {
  readonly model: VehicleModel;
  readonly state: VehicleState;
  t = 0;
  status: CarStatus = "RUNNING";
  private readonly halfWidth: number;
  private readonly timeLimit: number;
  private readonly hasher = new Hasher();

  private segIndex: number;
  private s: number;
  private n = 0;
  private trackHeading: number;
  private surface: SurfaceOrBarrier = "track";
  private frontIdx: number;
  private rearIdx: number;
  private progress = 0;
  private sectorsDone = 0;
  private sectorTimes: number[] = [];
  private lapValid = true;
  private offTrack = false;
  private stallTime = 0;
  private lastCmd: Controls = { throttle: 0, brake: 0, steer: 0 };

  lap: LapRecord | null = null;
  readonly events: SimEvent[] = [];
  readonly frames: CarFrames = {
    x: [],
    y: [],
    yaw: [],
    speed: [],
    steer: [],
    throttle: [],
    brake: [],
    surface: [],
    lap: [],
    s: [],
  };
  readonly telemetry?: TelemetryLog;
  private offTracks = 0;
  private strikes = 0;
  private maxSpeed = 0;
  private readonly errors: string[] = [];

  constructor(
    readonly track: Track,
    readonly car: CarConfig,
    readonly entry: CarEntry,
    readonly cfg: SessionConfig,
  ) {
    this.model = new VehicleModel(car);
    this.halfWidth = car.public.width / 2;
    this.timeLimit = LAUNCH_TIME + (cfg.timeLimit ?? LAP_TIME_LIMIT);
    const v0 = launchSpeed(track);
    this.maxSpeed = v0;
    const start = track.toWorld(0, 0);
    this.state = initialState(start.x, start.y, start.heading);
    this.state.vx = v0;
    this.state.yawRate = track.curvature[0]! * v0;
    this.state.throttle = 1;
    const p = track.project(start.x, start.y);
    this.segIndex = p.index;
    this.s = p.s;
    this.trackHeading = p.heading;
    this.frontIdx = p.index;
    this.rearIdx = p.index;
    if (cfg.recordTelemetry) {
      this.telemetry = {
        t: [],
        s: [],
        n: [],
        speed: [],
        throttle: [],
        brake: [],
        steer: [],
        ax: [],
        ay: [],
        surface: [],
      };
    }
    this.recordLaunch(v0);
    this.t = LAUNCH_TIME;
  }

  /** The run-up frames: the same for every car, along the centreline, accelerating onto the line. */
  private recordLaunch(v0: number): void {
    const f = this.frames;
    for (let i = 0; i < LAUNCH_TICKS; i++) {
      const { s, v } = launchPoint(v0, LAUNCH_TIME - i * CONTROL_DT);
      const w = this.track.toWorld(s, 0);
      f.x.push(w.x);
      f.y.push(w.y);
      f.yaw.push(w.heading);
      f.speed.push(v);
      f.steer.push(0);
      f.throttle.push(1);
      f.brake.push(0);
      f.surface.push(0);
      f.lap.push(0);
      f.s.push(wrapS(s, this.track.length));
      this.hasher.number(w.x).number(w.y).number(w.heading).number(v);
    }
  }

  private event(type: EventType, value?: number, detail?: string): void {
    const e: SimEvent = { t: this.t, type, lap: 1 };
    if (value !== undefined) e.value = value;
    if (detail !== undefined) e.detail = detail;
    this.events.push(e);
  }

  private setStatus(s: CarStatus, detail?: string): void {
    this.status = s;
    this.event("status", undefined, detail ? `${s} (${detail})` : s);
  }

  private strike(msg: string): void {
    this.strikes++;
    this.errors.push(`t=${this.t.toFixed(2)}: ${msg}`);
    this.event("strike", this.strikes, msg);
    if (this.strikes >= MAX_STRIKES) this.setStatus("DNF: ECU FAILURE", msg);
  }

  /** Run the driver's init. Returns false if it failed (car is then DNF). */
  init(): boolean {
    try {
      this.entry.runtime.init(this.track.toInfo(), carSpec(this.car));
      return true;
    } catch (e) {
      const msg = `init failed: ${errMsg(e)}`;
      this.errors.push(msg);
      this.setStatus("DNF: ECU FAILURE", msg);
      return false;
    }
  }

  telemetryNow(): Telemetry {
    const st = this.state;
    const surf: Surface = this.surface === "barrier" ? "gravel" : this.surface;
    return {
      t: this.t,
      lap: 1,
      lapTime: this.t - LAUNCH_TIME,
      sector: this.sectorsDone + 1,
      s: this.s,
      n: this.n,
      headingError: wrapAngle(st.yaw - this.trackHeading),
      x: st.x,
      y: st.y,
      yaw: wrapAngle(st.yaw),
      speed: speedOf(st),
      vx: st.vx,
      vy: st.vy,
      yawRate: st.yawRate,
      ax: st.ax,
      ay: st.ay,
      steer: st.steer / this.car.public.maxSteer,
      throttle: st.throttle,
      brake: st.brake,
      surface: surf,
      offTrackWarnings: this.offTracks,
    };
  }

  private readControls(raw: unknown): Controls {
    const prev = this.lastCmd;
    if (raw === null || typeof raw !== "object") {
      this.strike(`step returned ${raw === null ? "null" : typeof raw}, expected {throttle, brake, steer}`);
      return prev;
    }
    const o = raw as Record<string, unknown>;
    const bad: string[] = [];
    const pick = (k: keyof Controls, lo: number, hi: number) => {
      const v = o[k];
      if (!isNum(v)) {
        bad.push(k);
        return prev[k];
      }
      return clamp(v, lo, hi);
    };
    const c = { throttle: pick("throttle", 0, 1), brake: pick("brake", 0, 1), steer: pick("steer", -1, 1) };
    if (bad.length) this.strike(`invalid control value(s): ${bad.join(", ")}`);
    return c;
  }

  private record(): void {
    const st = this.state;
    const f = this.frames;
    f.x.push(st.x);
    f.y.push(st.y);
    f.yaw.push(st.yaw);
    const v = speedOf(st);
    f.speed.push(v);
    f.steer.push(st.steer / this.car.public.maxSteer);
    f.throttle.push(st.throttle);
    f.brake.push(st.brake);
    f.surface.push(SURFACE_CODES.indexOf(this.surface));
    f.lap.push(this.lap ? 2 : 1);
    f.s.push(this.s);
    const h = this.hasher;
    h.number(st.x).number(st.y).number(st.yaw).number(st.vx).number(st.vy).number(st.yawRate);
    h.number(st.steer).number(st.throttle).number(st.brake);
  }

  private recordTelemetry(tel: Telemetry): void {
    const l = this.telemetry;
    if (!l) return;
    l.t.push(tel.t);
    l.s.push(tel.s);
    l.n.push(tel.n);
    l.speed.push(tel.speed);
    l.throttle.push(tel.throttle);
    l.brake.push(tel.brake);
    l.steer.push(tel.steer);
    l.ax.push(tel.ax);
    l.ay.push(tel.ay);
    l.surface.push(tel.surface);
  }

  /** One control tick: driver step + PHYSICS_SUBSTEPS physics steps. */
  tick(): void {
    if (this.status !== "RUNNING") return;
    this.record();
    const tel = this.telemetryNow();
    this.recordTelemetry(tel);
    let raw: unknown;
    let ok = true;
    try {
      raw = this.entry.runtime.step(tel);
    } catch (e) {
      ok = false;
      this.strike(`step threw: ${errMsg(e)}`);
    }
    const cmd = ok ? this.readControls(raw) : this.lastCmd;
    this.lastCmd = cmd;
    if (this.status !== "RUNNING") return;
    const vcmd = { throttle: cmd.throttle, brake: cmd.brake, steer: cmd.steer * this.car.public.maxSteer };
    for (let k = 0; k < PHYSICS_SUBSTEPS && this.status === "RUNNING"; k++) this.physicsStep(vcmd);
  }

  private physicsStep(vcmd: { throttle: number; brake: number; steer: number }): void {
    const st = this.state;
    const tr = this.track;
    const ax = this.model.axles(st);
    const pf = tr.project(ax.fx, ax.fy, this.frontIdx);
    const pr = tr.project(ax.rx, ax.ry, this.rearIdx);
    this.frontIdx = pf.index;
    this.rearIdx = pr.index;
    const sfName = tr.surfaceAt(pf.index, pf.n, pf.widthLeft, pf.widthRight);
    const srName = tr.surfaceAt(pr.index, pr.n, pr.widthLeft, pr.widthRight);
    this.model.step(st, vcmd, SURFACES[sfName], SURFACES[srName], PHYSICS_DT);
    const tPrev = this.t;
    this.t = tPrev + PHYSICS_DT;

    const p = tr.project(st.x, st.y, this.segIndex);
    const prevProgress = this.progress;
    this.progress += loopDelta(this.s, p.s, tr.length);
    this.segIndex = p.index;
    this.s = p.s;
    this.n = p.n;
    this.trackHeading = p.heading;
    this.surface = tr.surfaceAt(p.index, p.n, p.widthLeft, p.widthRight);
    const v = speedOf(st);
    if (v > this.maxSpeed) this.maxSpeed = v;

    this.checkpoints(tPrev, prevProgress);
    if (this.status !== "RUNNING") return;
    this.trackLimits(p.n, p.widthLeft, p.widthRight);
    this.barrier(p.index, p.n, v);
    if (this.status !== "RUNNING") return;

    this.stallTime = v < STALL_SPEED ? this.stallTime + PHYSICS_DT : 0;
    if (this.stallTime > STALL_TIME) this.setStatus("DNF: STALLED");
    else if (this.t >= this.timeLimit - 1e-9) this.setStatus("TIME UP");
  }

  private checkpoints(tPrev: number, prevProgress: number): void {
    const L = this.track.length;
    const cross = (target: number) => {
      const f = (target - prevProgress) / (this.progress - prevProgress);
      return tPrev + PHYSICS_DT * clamp(f, 0, 1);
    };
    while (this.sectorsDone < 2 && this.progress >= this.track.sectors[this.sectorsDone]!) {
      const tc = cross(this.track.sectors[this.sectorsDone]!);
      const prevSum = this.sectorTimes.reduce((a, b) => a + b, 0);
      this.sectorTimes.push(tc - LAUNCH_TIME - prevSum);
      this.sectorsDone++;
      this.event("sector", this.sectorsDone);
    }
    if (this.sectorsDone === 2 && this.progress >= L) {
      const time = cross(L) - LAUNCH_TIME;
      const prevSum = this.sectorTimes.reduce((a, b) => a + b, 0);
      this.sectorTimes.push(time - prevSum);
      this.lap = { lap: 1, time, sectors: this.sectorTimes, valid: this.lapValid };
      this.event("lap", time, this.lapValid ? undefined : "invalid");
      this.setStatus("FINISHED");
    }
  }

  private trackLimits(n: number, wl: number, wr: number): void {
    const over = n >= 0 ? n - wl : -n - wr;
    if (!this.offTrack && over > this.halfWidth) {
      this.offTrack = true;
      this.offTracks++;
      this.lapValid = false;
      this.event("offTrack", Math.round(over * 100) / 100);
    } else if (this.offTrack && over < this.halfWidth - LIMIT_HYSTERESIS) {
      this.offTrack = false;
    }
  }

  private barrier(index: number, n: number, v: number): void {
    const left = n >= 0;
    const limit = this.track.barrierOffset(index, left) - this.halfWidth;
    if (Math.abs(n) < limit) return;
    const st = this.state;
    if (v > CRASH_SPEED) {
      st.vx = 0;
      st.vy = 0;
      st.yawRate = 0;
      this.event("crash", Math.round(v * 10) / 10);
      this.setStatus("DNF: CRASHED", `hit the barrier at ${Math.round(v * 3.6)} km/h`);
      return;
    }
    this.event("impact", Math.round(v * 10) / 10);
    const back = (left ? 1 : -1) * (limit - 0.3);
    const w = this.track.toWorld(this.s, back);
    st.x = w.x;
    st.y = w.y;
    st.vx = 0;
    st.vy = 0;
    st.yawRate = 0;
    this.n = back;
    this.surface = this.track.surfaceAt(
      index,
      back,
      this.track.widthLeft[index]!,
      this.track.widthRight[index]!,
    );
  }

  run(): CarRun {
    if (this.init()) {
      while (this.status === "RUNNING") this.tick();
    }
    this.record();
    return this.finish();
  }

  finish(): CarRun {
    for (const e of this.events) this.hasher.string(`${e.type}:${e.t}:${e.value ?? ""}`);
    const lap = this.lap;
    const result: CarResult = {
      id: this.entry.id,
      name: this.entry.name,
      status: this.status,
      lap,
      lapTime: lap?.valid ? lap.time : null,
      offTracks: this.offTracks,
      strikes: this.strikes,
      maxSpeed: this.maxSpeed,
      distance: this.progress,
      stateHash: this.hasher.digest(),
      errors: this.errors,
    };
    const run: CarRun = { result, frames: this.frames, events: this.events };
    if (this.telemetry) run.telemetry = this.telemetry;
    return run;
  }
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
