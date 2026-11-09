# Replay viewer redesign: plan

Six phases, one branch and pull request each, in this order. Every phase passes `make gates`, keeps the keyboard
map (Appendix A of the brief) working, holds 60 fps on a laptop with 8 cars (`F` readout), and is checked against
the renders in `screens/` at the replay time listed there. Proposal ids (R1, F2…) refer to the proposals doc.

## 1. Foundations (R1 part, R4, R5 part): this branch

- `packages/ui`: `tokens.json`, the generator (`make tokens`) for `tokens.gen.css` and `src/tokens.gen.ts`,
  Archivo and JetBrains Mono (OFL), contrast tests, `resolveEntries` (code, slot, provider body).
- Viewer: loads the tokens and fonts; the old style variables point at tokens; entry colours on every car mark;
  bodies painted by provider; race messages show entry codes; chalk replaces the red accent; new favicon.
- Deep links survive React StrictMode in dev (issue 8).
- Not yet: any new component. The HUD keeps its current layout.

## 2. Desktop HUD (R1 rest, R3, F3)

- `packages/ui` React components: `Wordmark`, `EntryChip`, `PositionBox`, `StatusBadge`, `GapChip`, `TowerRow`,
  `TimingTower` (with `MiniMap` in the panel), `SessionHeader` (with the GHOST RACE badge and its popover),
  `TelemetryGauge`, `FocusCard`, `RaceToast` / `ToastStack`, `Timeline`, `TransportBar`, `CarLabel`,
  `SegmentedControl`, `Button`, `IconButton`, `Icon`. Styling from `reference.css`, values from tokens.
- HUD store: `Driver.tsx` publishes a typed snapshot through `useSyncExternalStore` at 15 Hz; selectors in `lib/`.
- `lib/timeline.ts`: markers (start, fastest laps, warnings and penalties, DNFs, finish), merging under 12 px;
  click seeks 3 s before; `,` and `.` step between markers.
- 3D: livery stripe and rear-wing endplates in the entry colour; trail head at `opacity-trail`.
- Match: desktop TV, chase, onboard, map, finish.

## 3. Ghost start (F2)

- `lib/pack.ts`: packs of cars closer than 1.5 car lengths, in running order; groups at identical positions.
- Ghost materials (38% opacity, no shadow) for every car of a pack but the followed or front-most one; `PackLabel`;
  `StartBoard` while the spread is under 60 m and t under 15 s, back from the start marker.
- Constraint 2: positions are never touched. A test asserts the rendered position equals the replay sample.
- Match: desktop race start.

## 4. Incidents (F4, F3 slow motion)

- `lib/incidents.ts`: cause rules (power oversteer, wrong way, brake lock, barrier contact, ECU failure, stall,
  time-up) and the sentence template, table-tested on gp-1 (Sonnet and Luna) and synthetic frames.
- `IncidentCard`, incident replay mode (banner, 0.5× and 0.25×), pins on the minimap, a ground ring in 3D, the
  active timeline marker.
- Match: desktop incident.

## 5. Classification and analysis (F5, V11)

- The classification reads `event-results.json` and the manifests next to the replay when present: cost
  (`prices.json` estimates marked ≈ est.), tokens, build time, practice runs, points; the caveat banner from
  detected differences (effort, time limit, run budget, one-provider field).
- Analysis overlay: `SpeedTrace`, `DeltaChart` (time at equal distance, ending at the lap-time difference),
  `InputLanes`, `SectorTable`, and the one-line "where the time goes".
- Match: desktop classification, desktop analysis.

## 6. Phone viewer (F1)

- Below 600 px: header bar, `TowerStrip`, one toast at a time, the bottom panel (followed car, touch timeline,
  play, speed, cameras), and `Sheet` for the tower, the result, incidents and analysis.
- Gestures: tap a label or row to follow, swipe the scene to change car, pinch to zoom TV. The TV camera frames
  the car in the visible area between the bands (view offset).
- Performance (constraint 9): no backdrop blur, device pixel ratio capped at 2, fewer distant trees.
- Match: every phone render.

## Later, outside the viewer

Replays carry `code`, `slot` and `provider` from `models.json` (optional fields, format version unchanged, no
effect on hashes), so colours match the renders and stay stable across a season. Then `bench publish` (R2).
