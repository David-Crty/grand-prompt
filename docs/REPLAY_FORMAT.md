# Replay format (formatVersion 1)

A replay is one JSON document, stored gzipped as `replay.json.gz`. Types live in
`packages/sim/src/replay.ts` (`Replay`), and `sampleFrames()` there is the reference interpolation.
The viewer only plays this file. It never runs physics.

```jsonc
{
  "format": "bench-replay",
  "formatVersion": 1,
  "header": {
    "simVersion": "0.1.0", "apiVersion": "0.1", "ddkVersion": "0.1.0",
    "trackId": "proto-ring", "trackHash": "…", "carId": "proto-ow", "carHash": "…",
    "seed": 42,
    "session": { "type": "race", "laps": 3, "seed": 42, "infoLevel": "A" },
    "frameRate": 50,                 // frames per second, per car
    "stateHash": "…",                // determinism hash over full-precision state
    "car": { "length": 5.6, "width": 2.0, "wheelbase": 3.6 },
    "referenceLap": 70.6             // optional, house driver best lap
  },
  "track": { /* TrackData, see below */ },
  "cars": [ /* ReplayCar */ ],
  "classification": [ /* ClassifiedResult, ordered by position */ ]
}
```

## Track (`TrackData`)

The processed track, so the viewer never repeats preprocessing. Every per-sample array has
`length / spacing` entries. Sample `i` sits at `s = i * spacing`, and the track is closed, so the
last sample connects back to sample 0.

| field | meaning |
|---|---|
| `id`, `name`, `version`, `hash` | identity |
| `length`, `spacing` | m |
| `sectors` | `[s1End, s2End]` in m; the start/finish line is at s = 0 |
| `x`, `y` | centerline (m). World plane is x/y; z is up in the viewer |
| `heading` | rad, direction of travel |
| `curvature` | 1/m, positive = left turn |
| `widthLeft`, `widthRight` | m from the centerline to each white line |
| `kerbLeft`, `kerbRight` | 0/1. Kerb band of 1.2 m just outside the white line |
| `runoffTypeLeft/Right` | 0 = grass, 1 = gravel |
| `runoffWidthLeft/Right` | m from the white line to the barrier |

The left normal at sample `i` is `(-sin(heading), cos(heading))`. A Frenet point `(s, n)` maps to
world as `center(s) + n * normal(s)`.

## Cars (`ReplayCar`)

```jsonc
{
  "id": "ref-100", "name": "Reference 100%", "color": "#e63946", "driverHash": "…",
  "frames": {            // columnar, frame k is at t = k / frameRate
    "x": [], "y": [],    // m, car centre (CG)
    "yaw": [],           // rad (not wrapped: interpolate the short way)
    "speed": [],         // m/s
    "steer": [],         // -1..1 (fraction of maxSteer, positive = left)
    "throttle": [], "brake": [],  // 0..1, actual actuator positions
    "surface": [],       // 0 track, 1 kerb, 2 grass, 3 gravel, 4 barrier
    "lap": [],           // lap currently being driven (1-based)
    "s": []              // m along the centerline
  },
  "events": [ { "t": 12.3, "type": "lap", "lap": 1, "value": 75.7, "detail": "invalid" } ],
  "result": { /* CarResult: status, laps[], bestLap, totalTime, penalties, … */ }
}
```

The frames stop when the car's session ends (finish or DNF). After that the car should stay at
its last frame, shown with its final status.

### Event types

| type | value | detail |
|---|---|---|
| `lap` | lap time (s) | `"invalid"` if the lap was deleted for track limits |
| `sector` | sector number completed (1, 2) | |
| `offTrack` | metres beyond the limit | |
| `warning` | warning count (race) | |
| `penalty` | seconds added | reason |
| `impact` | speed (m/s): low-speed barrier contact, car stopped and continues | |
| `crash` | speed (m/s) | |
| `strike` | strike count | error message (driver code fault) |
| `status` | | new status text, e.g. `"FINISHED"`, `"DNF: CRASHED (…)"` |

Statuses: `RUNNING`, `FINISHED`, `DNF: CRASHED`, `DNF: STALLED`, `DNF: ECU FAILURE`, `TIME UP`.

## Size

At 50 Hz, a 3-lap, 4-car race is about 2.4 MB of JSON and 0.6 MB gzipped. Values are rounded
(1 cm for positions, 1e-4 rad for yaw). The determinism hash is computed before rounding.
