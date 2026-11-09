# TelemetryGauge

The focused car's inputs: speed numeral, throttle and brake bars, steering tick, and the surface under the car.

**Provide**: a `CarSample` (`speed` m/s, `throttle` 0..1, `brake` 0..1, `steer` −1..1, `surface`, `ended`).

- Throttle and brake are separate bars with THR and BRK labels; never one bar with two colours.
- Steering: a chalk tick on a centred track; left is left.
- Surface reads TRACK or KERB in neutral, GRASS or GRAVEL on `status-warn` (the car is off track, the lap may be deleted).
- Retired or finished (`ended`): speed 0, bars empty, the card dims to `opacity-out`.

Maps to `<TelemetryGauge sample>`; `<SpeedReadout>` is the numeral alone (phone).
