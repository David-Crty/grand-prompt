# Driver Specification (driver development kit 0.5.0, API 0.1)

You are writing the control program of an open-wheel race car. Your program is a single
JavaScript ES module. It is called 50 times per second of simulated time, and it must drive the
car around a circuit as fast as possible without crashing or leaving the track. Nothing runs
during the session except your code. There are no pauses and no outside help.

Types are in `driver.d.ts`. A complete but slow working driver is in `baseline-driver.js`.

## 1. Module shape

```js
export function init(track, car) { /* once, before the session; precompute here */ }
export function step(t) { return { throttle: 0..1, brake: 0..1, steer: -1..1 }; }
```

- State between calls lives in module scope.
- `init` gets the full track geometry (`TrackInfo`: centerline samples every ~2 m with position,
  heading, curvature and widths) and the public car parameters (`CarSpec`).
- `step` gets `Telemetry` and returns `Controls`. `steer` is a fraction of `car.maxSteer`, and
  positive steers left. Your commands are held for the next 20 ms.
- TypeScript is accepted (it is transpiled; types are erased). The module must be self-contained:
  imports of packages or Node built-ins fail.

## 2. Coordinates

- SI units. World plane x/y, angles counter-clockwise from +x. `yaw` is where the car points.
- Frenet coordinates: `s` = distance along the centerline from the start/finish line (0..length,
  wrapping at the line), `n` = lateral offset from the centerline, positive to the left.
  `headingError` = yaw − centerline heading at `s`.
- `track.samples[i].s = i * sampleSpacing`. The track is a closed loop. The left normal of a
  sample is `(-sin(heading), cos(heading))`, so the point at `(s, n)` is `center + n * normal`.
- The track is driven in the direction of increasing `s`.

## 3. The session: one flying lap

Each car runs **alone on the circuit** (ghost mode). There are no opponents or collisions between
cars. Every car gets the same conditions. Practice runs and the event are the same session: **one
flying lap**, scored by its time.

- **Flying start**: the car is already moving when your program takes over. It crosses the line
  (s = 0) on the centerline (n = 0), pointing along the track, at full throttle and at a launch
  speed that depends on the circuit (up to 250 km/h, lower where a corner is close to the line).
  Your first `step` call is at that moment: read `t.speed` to know the launch speed. `init` runs
  before that, as usual. The 3 s run-up before the line is the same for every car and you do not
  drive it.
- **Timing** starts at the line and stops when you cross it again. The lap counts only if the
  sector checkpoints are crossed in order. Cutting the circuit or driving backwards does not count.
- **Track limits**: you are off track when your car's centre is more than half the car width
  (1.0 m) beyond the white line, i.e. `n > widthLeft + 1.0` or `n < -(widthRight + 1.0)`. **Any
  off-track moment deletes the lap**: it scores no time.
- **Classification**: valid laps by time, then cars without a time (deleted laps first, then
  retirements).
- **Surfaces** beyond the white line: kerbs on the inside of most corners (1.2 m wide, slightly
  less grip), then grass (much less grip, extra drag) or gravel (very little grip, heavy drag),
  then a barrier.
- **Barrier**: hitting it above 12 m/s (43 km/h) is a crash (`DNF: CRASHED`). Slower contact stops
  the car, which can then drive on.
- **Stalled**: below 1 m/s for more than 10 s is `DNF: STALLED`.
- **Session time limit**: 300 s after the line, then `TIME UP`.

## 4. Error policy (the "ECU")

- If `step` throws, returns something that is not an object, returns NaN/missing fields, or exceeds
  its compute budget, the car keeps the previous controls and you receive a **strike**. Out-of-range
  numbers are clamped without a strike.
- **3 strikes**, or any failure in `init` or while loading the module = `DNF: ECU FAILURE`.

## 5. Sandbox and budgets

Your code runs in a QuickJS interpreter (ES2023, no JIT, roughly 20 to 50 times slower than V8).

- No `Date`, no timers, no `fetch`, `require`, `process` or file system. `Math.random` is seeded
  per session, so runs are reproducible.
- 64 MB memory limit, 1 MB stack.
- Compute is metered in **budget units**. One unit is about 10,000 interpreter operations (loop
  iterations and function calls).
  - `init`: 20,000 units. That is enough for seconds of heavy precomputation, e.g. thousands of
    iterations over all track samples.
  - `step`: 20 units per call. That is enough for a few hundred iterations over track samples per
    call, not for re-optimizing the whole lap at every step.
  - Budget metering is deterministic: the same code gives the same result.
- `log(...)` (and `console.log`) writes to `log.txt` in practice runs, up to 500 lines of 300
  characters. It does nothing in the event.

## 6. The car (qualitative physics)

The public parameters are in `CarSpec` / `car-public.json`. Tire and aerodynamic constants are
**hidden** (information level B). You can infer them from practice telemetry (`ax`, `ay`,
`speed`, slip behaviour).

- **Model**: a planar "bicycle" model (front axle, rear axle) with yaw dynamics, simulated at
  500 Hz. Rear-wheel drive, no gearbox.
- **Tires**: lateral force grows with slip angle up to a peak (a few degrees), then falls off.
  Past the peak, more steering gives _less_ grip. Grip grows with vertical load, but less than
  proportionally.
- **Combined grip**: on each axle, longitudinal and lateral forces share one friction budget (a
  friction circle). Braking or accelerating hard uses up cornering grip. If you ask for more than
  the axle has, it slides: **wheelspin** at the rear (power oversteer, spins) or **lock-up**
  (understeer, the car goes straight on). In both cases that axle's lateral grip mostly vanishes.
- **Aerodynamics**: downforce and drag grow with speed squared. Downforce adds a lot of grip at
  high speed, so fast corners allow much higher lateral acceleration than slow ones. Drag limits
  top speed and helps braking at high speed.
- **Power**: limited by engine power at high speed (force ≈ P / v), and by rear traction at low
  speed. **Flooring the throttle at low or medium speed spins the rear wheels.** Throttle must be
  progressive on corner exit.
- **Brakes**: front-biased. Peak deceleration is highest at high speed (downforce plus drag) and
  drops as the car slows. Braking shifts load to the front.
- **Actuators** are rate-limited (`steerRate`, `throttleRate`, `brakeRate`). The `steer`,
  `throttle` and `brake` fields in telemetry are the actual positions, which lag your commands.
- **Low speed** (below about 4 m/s): the car behaves kinematically, so it turns where the wheels
  point.

## 7. Tools

- `bench validate driver.js`: loads the module, runs `init`, and drives 10 s. Reports errors,
  strikes and compute usage.
- `bench practice driver.js`: one flying lap, exactly as in the event. Lap and sector times,
  events, where and when the car went out if it did, `telemetry.csv` (one row per step: t, s,
  speed, throttle, brake, steer, n, surface, ax, ay, headingError, vy), `summary.json` and
  `log.txt`.

## 8. Hints

- Precompute in `init`: a racing line within the track width, a curvature-based speed limit, and
  braking points (a backward pass over the lap). Track `s` from telemetry to index your arrays.
- Remember that `s` wraps at the finish line, and so do your lookahead indices. The first corner
  comes up at speed: your braking logic must work from the very first step.
- Keep `step` cheap. Look up precomputed tables, then run a small controller.
- Steering: geometric path tracking (pure pursuit, Stanley) works. At speed, the car needs some
  slip angle to corner.
- Longitudinal control: anticipate. Brake before the corner, not in it, and squeeze the throttle
  on exit.
