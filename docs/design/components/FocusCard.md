# FocusCard

The lower third for the focused car: identity band, telemetry, and the lap row (current lap time, last lap, best lap).

**Provide**: `row`, `entry`, `sample`, `laps` (`current`, `last`, `best`), `fastest` (best lap is the overall fastest: shown in `timing-fastest`).

- Width 320 px, bottom-left above the transport on desktop. On phones it collapses to one row in the bottom panel: chip, name, speed, gap.
- The band repeats position and entry so the card reads on its own in screenshots.
- States: running; off track (surface badge); retired (DNF badge in the band, body dimmed, lap row keeps the last values); finished (FIN badge); first lap (LAST and BEST show `–`).

Maps to `<FocusCard>`.
