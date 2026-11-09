# Physics model (sim 0.1.0)

Source: `packages/sim/src/vehicle.ts`, with parameters in `cars/proto.json`. This document is
internal. The DDK only describes the model qualitatively (information level B).

## State and integration

State: `x, y, yaw, vx, vy, r` (body-frame velocities, yaw rate), plus the actuator positions
`steer` (rad at the wheels), `throttle` and `brake`, and the previous step's body acceleration
`ax, ay`, which is used for load transfer.

- Physics runs at 500 Hz with semi-implicit Euler: velocities first, then pose from the new
  velocities.
- The driver runs at 50 Hz, and its commands are held for 10 substeps.
- Actuators are rate-limited toward their commanded values: steer 1.6 rad/s, throttle 10/s,
  brake 16/s.

## Forces

Aero, with `q = ½ρv²`: drag is `q·CdA`, and downforce is `q·ClA`, split by `aeroBalanceFront`.

Vertical loads:

    Fzf = m g lr/L + DF·ab − m·ax·h/L
    Fzr = m g lf/L + DF·(1−ab) + m·ax·h/L        (each ≥ 50 N)

Friction coefficient per axle, with load sensitivity and surface grip:

    μ = μ0 · max(0.3, 1 − k·(Fz/Fz_static − 1)) · grip
    cap = μ · Fz

Longitudinal demand:
- Drive on the rear: `throttle · min(P / max(v, 1), Fdrive_max)`.
- Brakes: `brake · Fbrake_max`, split by bias, always opposing `vx`, and limited to what stops
  the car within one step, so braking never reverses it.

Friction circle per axle: if `|Fx| ≥ cap`, the axle slides, so `Fx = 0.95·cap·sign`, and
the lateral capacity drops to `√(1 − 0.95²) ≈ 31%`. Otherwise the lateral capacity is
`√(1 − (Fx/cap)²)`.

Lateral force (simplified Pacejka): `Fy = cap · latFraction · sin(C·atan(B·α))`, with slip
angles taken in each tire's frame:

    αf = −atan2(vyw, max(|vxw|, 0.5)),   front wheel velocities rotated by δ
    αr = −atan2(vy − lr·r, max(|vx|, 0.5))

Resistances are rolling `Crr·(Fzf+Fzr)` plus surface drag (grass 0.12 g and gravel 0.6 g of
axle weight), and they never reverse the car.

Equations of motion:

    m·ax = Fxr + Fxf cosδ − Fyf sinδ − sign(vx)·R
    m·ay = Fyr + Fyf cosδ + Fxf sinδ
    Iz·ṙ = lf (Fyf cosδ + Fxf sinδ) − lr Fyr
    v̇x = ax + vy·r,  v̇y = ay − vx·r

Low speed: below 4.5 m/s the derivatives blend linearly (weight `(v − 1.5)/3`) toward a
kinematic bicycle (`vy → vx·tanδ·lr/L`, `r → vx·tanδ/L`, time constant 30 ms). That avoids the
singularity as `vx → 0`.

## Stability of the integrator

The stiffest mode is the yaw and lateral relaxation, `(Cf·lf² + Cr·lr²)/(Iz·vx)`. At
`vx = 4.5 m/s` this is about 250 1/s, so `dt·λ ≈ 0.5`, within explicit stability (< 2). Below
that speed, the kinematic blend takes over.

## Surfaces

| surface | grip × | drag (g) |
|---|---|---|
| track | 1.0 | 0 |
| kerb | 0.9 | 0 |
| grass | 0.5 | 0.12 |
| gravel | 0.4 | 0.6 |

The surface is evaluated separately at the front and rear axle positions, so one axle can be on
the grass while the other is on track.

## Plausibility (asserted in `vehicle.test.ts`)

| target (PLAN 5.3) | measured |
|---|---|
| top speed 320–350 km/h | 341 km/h |
| peak braking 4.5–5.5 g | 5.26 g |
| ~2 g slow corners | 1.88 g at 72 km/h |
| 4–5 g fast corners | 4.24 g at 306 km/h (3.5 g at 252 km/h) |
| 0–100 km/h 2.5–3 s | 2.56 s |

On the Prototype Ring, the house reference driver laps in 1:10.6, and the DDK baseline in 1:31.9.

## Known simplifications

- No wheel speeds, so slip ratio is binary (within the friction circle, or sliding).
- No gearbox, no tire temperature or wear, no lateral load transfer.
- Drag is applied along the body x axis.
