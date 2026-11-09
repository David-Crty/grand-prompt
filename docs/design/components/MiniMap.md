# MiniMap

The circuit as a ribbon with every car as a dot in its entry colour, the start line, and incident pins.

**Provide**: `track` (from the replay), `samples` (car positions at `t`), `focusId`, `incidents`, `labels` (codes beside dots: map camera and phone), optional `highlight` (a stretch of track, for sectors or an incident zone).

- Dots draw back to front by position so the leader is on top; the focused dot is larger with a chalk ring.
- Retired cars leave the map; their pin stays.
- Tapping a dot focuses that car.
- On event cards and pages the same component draws the track alone (no cars) as the circuit's thumbnail.

Maps to `<MiniMap>`; projection stays in `lib/minimap.ts`.
