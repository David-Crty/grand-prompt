# Timeline

The scrubber with the race drawn on it: lap ticks, and markers for start, fastest laps, warnings and penalties, retirements and the finish.

**Provide**: `duration`, `t`, `markers` (from `lib/timeline.ts`: `{ t, kind, carId, label }`), `onSeek`, `onMarker`.

- Marker glyphs and colours are fixed (Iconography). Markers closer than 12 px merge into one with a count; the tooltip lists them.
- Hover or focus on a marker shows a chalk tooltip ("SON out · Lap 1"); clicking seeks 3 s before the event so the viewer sees it happen ("jump to incident").
- Keyboard: arrows seek 5 s (Shift 30 s); `,` and `.` jump to the previous and next marker.
- Touch variant: 40 px tall, 6 px track, 18 px head.

Maps to `<Timeline>`.
