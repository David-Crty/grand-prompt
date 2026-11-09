import type { Replay, ReplayCar, SimEvent, TrackData } from "@bench/sim";

/** Closed stadium: two straights joined by semicircles, counter-clockwise, starting at (0, 0) heading +x. */
export function stadiumTrack(straight = 300, radius = 60, spacing = 2): TrackData {
  const length = 2 * straight + 2 * Math.PI * radius;
  const n = Math.round(length / spacing);
  const sp = length / n;
  const t: TrackData = {
    id: "stadium",
    name: "Stadium",
    version: 1,
    hash: "h",
    length,
    spacing: sp,
    sectors: [length / 3, (2 * length) / 3],
    x: [],
    y: [],
    heading: [],
    curvature: [],
    widthLeft: [],
    widthRight: [],
    kerbLeft: [],
    kerbRight: [],
    runoffTypeLeft: [],
    runoffTypeRight: [],
    runoffWidthLeft: [],
    runoffWidthRight: [],
  };
  const arc = Math.PI * radius;
  for (let i = 0; i < n; i++) {
    const s = i * sp;
    let x: number;
    let y: number;
    let h: number;
    let k = 0;
    if (s < straight) {
      x = s;
      y = 0;
      h = 0;
    } else if (s < straight + arc) {
      const a = (s - straight) / radius;
      x = straight + radius * Math.sin(a);
      y = radius - radius * Math.cos(a);
      h = a;
      k = 1 / radius;
    } else if (s < 2 * straight + arc) {
      x = straight - (s - straight - arc);
      y = 2 * radius;
      h = Math.PI;
    } else {
      const a = (s - 2 * straight - arc) / radius;
      x = -radius * Math.sin(a);
      y = radius + radius * Math.cos(a);
      h = Math.PI + a;
      k = 1 / radius;
    }
    t.x.push(x);
    t.y.push(y);
    t.heading.push(h);
    t.curvature.push(k);
    t.widthLeft.push(6);
    t.widthRight.push(6);
    t.kerbLeft.push(k > 0 ? 1 : 0);
    t.kerbRight.push(k > 0 ? 1 : 0);
    t.runoffTypeLeft.push(0);
    t.runoffTypeRight.push(k > 0 ? 1 : 0);
    t.runoffWidthLeft.push(15);
    t.runoffWidthRight.push(k > 0 ? 25 : 15);
  }
  return t;
}

function centerAt(track: TrackData, s: number): { x: number; y: number; h: number } {
  const u = (((s % track.length) + track.length) % track.length) / track.spacing;
  const i = Math.floor(u) % track.x.length;
  const j = (i + 1) % track.x.length;
  const a = u - Math.floor(u);
  return {
    x: track.x[i]! + (track.x[j]! - track.x[i]!) * a,
    y: track.y[i]! + (track.y[j]! - track.y[i]!) * a,
    h: track.heading[i]!,
  };
}

export interface CarOpts {
  id: string;
  speed: number;
  laps?: number;
  frameRate?: number;
  /** Stop (DNF) after this many seconds. */
  dnfAt?: number;
  invalidLaps?: number[];
  extraEvents?: SimEvent[];
  startS?: number;
}

/** A car driving the centerline at constant speed, with lap events and a final status. */
export function makeCar(track: TrackData, o: CarOpts): ReplayCar {
  const laps = o.laps ?? 2;
  const fr = o.frameRate ?? 10;
  const raceDist = laps * track.length;
  const startS = o.startS ?? 0;
  const finishT = (raceDist - startS) / o.speed;
  const endT = o.dnfAt !== undefined ? Math.min(o.dnfAt, finishT) : finishT;
  const n = Math.floor(endT * fr) + 1;
  const f = {
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
  } as {
    [K in keyof ReplayCar["frames"]]: number[];
  };
  for (let k = 0; k < n; k++) {
    const t = k / fr;
    const d = startS + o.speed * t;
    const c = centerAt(track, d);
    f.x.push(c.x);
    f.y.push(c.y);
    f.yaw.push(c.h);
    f.speed.push(o.speed);
    f.steer.push(0.1);
    f.throttle.push(1);
    f.brake.push(0);
    f.surface.push(k % 50 === 7 ? 2 : 0);
    f.lap.push(Math.floor(d / track.length) + 1);
    f.s.push(d % track.length);
  }
  const events: SimEvent[] = [];
  const lapTime = track.length / o.speed;
  for (let l = 1; l <= laps; l++) {
    const t = (l * track.length - startS) / o.speed;
    if (t > endT + 1e-9) break;
    const ev: SimEvent = { t, type: "lap", value: l === 1 ? lapTime + 1 : lapTime - l * 0.01 };
    if (o.invalidLaps?.includes(l)) ev.detail = "invalid";
    events.push(ev);
  }
  const dnf = o.dnfAt !== undefined && o.dnfAt < finishT;
  events.push({
    t: endT,
    type: "status",
    detail: dnf ? "DNF: CRASHED (barrier)" : "FINISHED",
  });
  if (o.extraEvents) events.push(...o.extraEvents);
  const valid = events.filter((e) => e.type === "lap" && e.detail !== "invalid");
  const best = valid.reduce<SimEvent | null>((b, e) => (!b || e.value! < b.value! ? e : b), null);
  return {
    id: o.id,
    name: `Car ${o.id}`,
    driverHash: "d",
    frames: f,
    events,
    result: {
      id: o.id,
      name: `Car ${o.id}`,
      status: dnf ? "DNF: CRASHED" : "FINISHED",
      lap: null,
      lapTime: best?.value ?? null,
      offTracks: 0,
      strikes: 0,
      maxSpeed: o.speed,
      distance: o.speed * endT,
      stateHash: "s",
      errors: [],
    },
  };
}

export function makeReplay(cars: ReplayCar[], track = stadiumTrack(), frameRate = 10): Replay {
  return {
    format: "bench-replay",
    formatVersion: 1,
    header: {
      simVersion: "0",
      apiVersion: "0",
      ddkVersion: "0",
      trackId: track.id,
      trackHash: track.hash,
      carId: "c",
      carHash: "c",
      seed: 3,
      session: { seed: 3 },
      frameRate,
      launch: { time: 0, speed: 50 },
      stateHash: "x",
      car: { length: 5.6, width: 2, wheelbase: 3.6 },
    },
    track,
    cars,
    classification: [],
  };
}
