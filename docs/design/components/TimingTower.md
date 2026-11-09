# TimingTower

The live running order: header (wordmark, lap counter), one `TowerRow` per car, and a footer with the gap or interval toggle.

**Provide**: `rows` (`liveStandings(cars, t, laps)`), `entries`, `focusId`, `fastestId`, `mode`, `onFocus`, `onMode`, `density` (`auto`: dense from 10 cars), `layout` (`panel` desktop, `sheet` phone).

- Header: `LAP 3/5` while racing, `FINAL` when every car has finished or retired. Qualifying shows `QUALIFYING` and best-lap times instead of gaps.
- Order: finished cars by finish time, running cars by distance, retired cars last. This is ghost order by distance, and is labelled as such in the help.
- 12 cars fit at 24 px rows without scrolling (header 40 + 12 × 24 + footer 36 = 364 px).
- Loading: header plus eight `gp-skel` rows. Error: the tower is hidden and the viewer shows its error state.
- Keyboard: Tab, `]` and `[` move focus between cars; G toggles gap and interval.

Maps to `<TimingTower>`; logic stays in `lib/timing.ts`.
