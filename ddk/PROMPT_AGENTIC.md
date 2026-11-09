<!-- prompt version: agentic-0.1 -->
# Task: write the fastest race-car driver program

You are competing in a programming benchmark. In this workspace, write `driver.js`: the control
program for a simulated open-wheel race car. All competitors drive the same car on the same
circuit in a deterministic simulator, and the fastest valid result wins.

## Files

- `DRIVER_SPEC.md`: rules, API, physics (read it first)
- `driver.d.ts`: types
- `car-public.json`: public car parameters
- `baseline-driver.js`: a working but slow driver
- `driver.js`: your driver, which starts as a copy of the baseline. **This file is your submission.**
- `tracks/`: the practice circuit (the same one used for the event)
- `bench.mjs`: the practice client

## Practice

```
node bench.mjs validate driver.js           # free: load + init + 10 s of driving
node bench.mjs practice driver.js --laps 3  # counts against your practice budget
node bench.mjs status                       # remaining practice runs
```

Each practice run writes `runs/NNN/summary.txt`, `summary.json`, `telemetry.csv` and `log.txt`.
Use the telemetry to learn how the car behaves: the tire and aero constants are hidden. Your
practice budget is limited, so plan your runs.

## Rules for this run

- Work only inside this workspace. Do not look for the simulator's source code or try to reach
  the practice service other than through `bench.mjs`.
- The event is qualifying (out lap, then one flying lap) followed by a multi-lap race. A crash or
  ECU failure scores worst of all, so robustness matters as much as raw speed.
- When you are done, leave your final program in `driver.js`.
