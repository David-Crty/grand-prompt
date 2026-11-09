# RaceToast

A race-control message: kind glyph, entry chip, one line of text, the replay time, and an optional action.

**Provide**: a `RaceMessage` (`lib/messages.ts`: `t`, `carId`, `kind`, `text`) and an optional `action` ("Why" opens the incident card, "Watch" seeks to it).

| kind | glyph fill | example |
| --- | --- | --- |
| `dnf` (crash, DNF) | `status-dnf` | Crashed at 102 km/h · Turn 2 |
| `warn` (track limits, deleted lap, penalty, barrier contact) | `status-warn` | Track limits warning 1 |
| `fastest` | `timing-fastest` | Fastest lap 1:36.962 |
| `finish` | chalk | Chequered flag |
| `info` | neutral | Lights out · 8 cars |

- Desktop: up to three stacked under the session header, newest at the bottom, each for `duration-toast`. Phone: one at a time under the header; a newer message replaces the older one, and DNFs wait their turn.
- Above 4× playback, low-priority kinds (barrier contact, warnings) are dropped from the stack but stay on the timeline.
- Announced through an `aria-live="polite"` region.

Maps to `<RaceToast message action>` and `<ToastStack messages t speed max>`.
