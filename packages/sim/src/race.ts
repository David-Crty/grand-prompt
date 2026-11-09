import { clamp, Hasher, loopDelta, Prng, wrapAngle } from "./math.js";
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
export const FREE_WARNINGS = 3;
export const TRACK_LIMIT_PENALTY = 5;
const LIMIT_HYSTERESIS = 0.3;

export type SessionType = "practice" | "qualify" | "race";
export type CarStatus =
  | "RUNNING"
  | "FINISHED"
  | "DNF: CRASHED"
  | "DNF: STALLED"
  | "DNF: ECU FAILURE"
  | "TIME UP";

export const SURFACE_CODES: SurfaceOrBarrier[] = ["track", "kerb", "grass", "gravel", "barrier"];

export interface SessionConfig {
  type: SessionType;
  /** practice/race: laps to run. qualify: flying laps after the out lap. */
  laps: number;
  seed: number;
  /** Session time limit in seconds (default depends on laps). */
  timeLimit?: number;
  infoLevel?: "A" | "B";
  /** Standard deviations of sensor noise (0 = off). */
  sensorNoise?: { position: number; speed: number };
  recordTelemetry?: boolean;
}

export interface LapRecord {
  lap: number;
  time: number;
  sectors: number[];
  valid: boolean;
}

export type EventType =
  | "lap"
  | "sector"
  | "offTrack"
  | "warning"
  | "penalty"
  | "impact"
  | "crash"
  | "strike"
  | "status";

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
  lapsCompleted: number;
  laps: LapRecord[];
  bestLap: number | null;
  bestLapNumber: number | null;
  /** Time at which the last required lap was completed (or session end). */
  finishTime: number | null;
  penalties: number;
  /** finishTime + penalties, race only. */
  totalTime: number | null;
  offTracks: number;
  warnings: number;
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
  lap: number[];
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

export function defaultTimeLimit(cfg: SessionConfig): number {
  const laps = cfg.type === "qualify" ? cfg.laps + 1 : cfg.laps;
  return 60 + laps * 240;
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
  private readonly lapsTarget: number;
  private readonly timeLimit: number;
  private readonly prng: Prng;
  private readonly hasher = new Hasher();

  private segIndex: number;
  private s: number;
  private n = 0;
  private trackHeading: number;
  private surface: SurfaceOrBarrier = "track";
  private frontIdx: number;
  private rearIdx: number;
  private progress = 0;
  private lapsCompleted = 0;
  private lapStart = 0;
  private sectorsDone = 0;
  private sectorTimes: number[] = [];
  private lapValid = true;
  private offTrack = false;
  private stallTime = 0;
  private lastCmd: Controls = { throttle: 0, brake: 0, steer: 0 };

  readonly laps: LapRecord[] = [];
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
  private warnings = 0;
  private penalties = 0;
  private strikes = 0;
  private maxSpeed = 0;
  private finishTime: number | null = null;
  private readonly errors: string[] = [];

  constructor(
    readonly track: Track,
    readonly car: CarConfig,
    readonly entry: CarEntry,
    readonly cfg: SessionConfig,
  ) {
    this.model = new VehicleModel(car);
    this.halfWidth = car.public.width / 2;
    this.lapsTarget = cfg.type === "qualify" ? cfg.laps + 1 : cfg.laps;
    this.timeLimit = cfg.timeLimit ?? defaultTimeLimit(cfg);
    this.prng = new Prng(cfg.seed ^ 0x5eed);
    const start = track.toWorld(0, 0);
    this.state = initialState(start.x, start.y, start.heading);
    const p = track.project(start.x, start.y);
    this.segIndex = p.index;
    this.s = p.s;
    this.trackHeading = p.heading;
    this.frontIdx = p.index;
    this.rearIdx = p.index;
    if (cfg.recordTelemetry) {
      this.telemetry = {
        t: [],
        lap: [],
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
  }

  private event(type: EventType, value?: number, detail?: string): void {
    const e: SimEvent = { t: this.t, type, lap: this.lapsCompleted + 1 };
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
      this.entry.runtime.init(this.track.toInfo(), carSpec(this.car, this.cfg.infoLevel ?? "B"));
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
    const noise = this.cfg.sensorNoise;
    const np = noise?.position ? () => this.prng.gaussian() * noise.position : () => 0;
    const nv = noise?.speed ? () => this.prng.gaussian() * noise.speed : () => 0;
    const surf: Surface = this.surface === "barrier" ? "gravel" : this.surface;
    return {
      t: this.t,
      lap: this.lapsCompleted + 1,
      lapTime: this.t - this.lapStart,
      sector: this.sectorsDone + 1,
      s: this.s,
      n: this.n + np(),
      headingError: wrapAngle(st.yaw - this.trackHeading),
      x: st.x + np(),
      y: st.y + np(),
      yaw: wrapAngle(st.yaw),
      speed: speedOf(st) + nv(),
      vx: st.vx + nv(),
      vy: st.vy + nv(),
      yawRate: st.yawRate,
      ax: st.ax,
      ay: st.ay,
      steer: st.steer / this.car.public.maxSteer,
      throttle: st.throttle,
      brake: st.brake,
      surface: surf,
      offTrackWarnings: this.warnings,
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
    f.lap.push(this.lapsCompleted + 1);
    f.s.push(this.s);
    const h = this.hasher;
    h.number(st.x).number(st.y).number(st.yaw).number(st.vx).number(st.vy).number(st.yawRate);
    h.number(st.steer).number(st.throttle).number(st.brake);
  }

  private recordTelemetry(tel: Telemetry): void {
    const l = this.telemetry;
    if (!l) return;
    l.t.push(tel.t);
    l.lap.push(tel.lap);
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
    const lapBase = this.lapsCompleted * L;
    while (this.sectorsDone < 2 && this.progress >= lapBase + this.track.sectors[this.sectorsDone]!) {
      const tc = cross(lapBase + this.track.sectors[this.sectorsDone]!);
      const prevSum = this.sectorTimes.reduce((a, b) => a + b, 0);
      this.sectorTimes.push(tc - this.lapStart - prevSum);
      this.sectorsDone++;
      this.event("sector", this.sectorsDone);
    }
    if (this.sectorsDone === 2 && this.progress >= lapBase + L) {
      const tc = cross(lapBase + L);
      const time = tc - this.lapStart;
      const prevSum = this.sectorTimes.reduce((a, b) => a + b, 0);
      this.sectorTimes.push(time - prevSum);
      const lap: LapRecord = {
        lap: this.lapsCompleted + 1,
        time,
        sectors: this.sectorTimes,
        valid: this.lapValid,
      };
      this.laps.push(lap);
      this.event("lap", time, lap.valid ? undefined : "invalid");
      this.lapsCompleted++;
      this.lapStart = tc;
      this.sectorTimes = [];
      this.sectorsDone = 0;
      this.lapValid = !this.offTrack;
      if (this.lapsCompleted >= this.lapsTarget) {
        this.finishTime = tc;
        this.setStatus("FINISHED");
      }
    }
  }

  private trackLimits(n: number, wl: number, wr: number): void {
    const over = n >= 0 ? n - wl : -n - wr;
    if (!this.offTrack && over > this.halfWidth) {
      this.offTrack = true;
      this.offTracks++;
      this.lapValid = false;
      this.event("offTrack", Math.round(over * 100) / 100);
      if (this.cfg.type === "race") {
        if (this.warnings < FREE_WARNINGS) {
          this.warnings++;
          this.event("warning", this.warnings);
        } else {
          this.penalties += TRACK_LIMIT_PENALTY;
          this.event("penalty", TRACK_LIMIT_PENALTY, "track limits");
        }
      }
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
    // Qualifying times only flying laps; practice prefers flying laps but falls back to the standing one.
    let pool = this.laps.filter((l) => l.valid);
    if (this.cfg.type === "qualify" || (this.cfg.type === "practice" && pool.some((l) => l.lap > 1)))
      pool = pool.filter((l) => l.lap > 1);
    let best: LapRecord | null = null;
    for (const l of pool) if (!best || l.time < best.time) best = l;
    const finished = this.status === "FINISHED";
    const result: CarResult = {
      id: this.entry.id,
      name: this.entry.name,
      status: this.status,
      lapsCompleted: this.lapsCompleted,
      laps: this.laps,
      bestLap: best?.time ?? null,
      bestLapNumber: best?.lap ?? null,
      finishTime: this.finishTime,
      penalties: this.penalties,
      totalTime: finished && this.cfg.type === "race" ? this.finishTime! + this.penalties : null,
      offTracks: this.offTracks,
      warnings: this.warnings,
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
