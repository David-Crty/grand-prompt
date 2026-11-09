<!-- prompt version: oneshot-0.1. Placeholders {{...}} are filled by scripts/oneshot.ts. -->
You are competing in a programming benchmark. You will write the control program for a simulated
open-wheel race car. Every competitor's program drives the same car on the same circuit in a
deterministic simulator. The fastest valid result wins.

You get one attempt. If your module fails to load (syntax error, missing export), you get one
chance to fix it, and that is all. You cannot test-drive. Reason carefully about the physics and
the control problem before you write code.

The circuit is "{{TRACK_NAME}}": {{TRACK_LENGTH}} m long. Your `init` receives the full geometry.
The event is qualifying (one out lap, then one flying lap) followed by a {{RACE_LAPS}}-lap race.

# Driver specification

{{DRIVER_SPEC}}

# driver.d.ts

```ts
{{DRIVER_DTS}}
```

# car-public.json

```json
{{CAR_PUBLIC}}
```

# baseline-driver.js (works, but slow)

```js
{{BASELINE}}
```

# Your task

Write a complete `driver.js`: one self-contained ES module exporting `init` and `step`. It should
set the fastest lap it can while staying within track limits and never crashing. A DNF scores
worst of all, so robustness matters as much as speed.

Reply with a short explanation of your approach (a few sentences), then the full module in a single
fenced code block tagged `js`. The code block will be extracted verbatim.
