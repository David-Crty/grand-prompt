<!-- prompt version: agentic-0.4 -->
# Task: write the fastest race-car driver program

You are competing in a programming benchmark. In this workspace, write `driver.js`: the control
program for a simulated open-wheel race car. All competitors drive the same car in a deterministic
simulator, and the fastest valid lap wins.

**The event is held on a circuit you will not see.** It is none of the practice circuits; your
driver meets it for the first time in `init`. Write a driver that works on any circuit, not one
tuned to the practice circuits.

## Files

- `DRIVER_SPEC.md`: rules, API, physics (read it first)
- `driver.d.ts`: types
- `car-public.json`: public car parameters
- `baseline-driver.js`: a working but slow driver
- `driver.js`: your driver, which starts as a copy of the baseline. **This file is your submission.**
- `tracks/`: the practice circuits: {{PRACTICE_TRACKS}}
- `bench.mjs`: the practice client

## Practice

```
node bench.mjs validate driver.js [--track <id>]   # free: load + init + 10 s of driving
node bench.mjs practice driver.js --track <id>  # one flying lap; counts against your practice budget
node bench.mjs status                       # remaining practice runs and the circuits
```

Each practice run writes `runs/NNN/summary.txt`, `summary.json`, `telemetry.csv` and `log.txt`.
Use the telemetry to learn how the car behaves: the tire and aero constants are hidden. The budget
is shared across the practice circuits and you choose which circuit each run uses (`--track`,
default: the first one). It is small (`node bench.mjs status` shows it), so plan your runs: `validate` is free
and catches load and init errors, so use it before every practice run.

## Rules for this run

- Work only inside this workspace. Do not look for the simulator's source code or try to reach
  the practice service other than through `bench.mjs`.
- The event is one flying lap, exactly like a practice run. Leaving the track deletes the lap and
  a crash or ECU failure scores worst of all, so robustness matters as much as raw speed.
- When you are done, leave your final program in `driver.js`.
