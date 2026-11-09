# TowerRow

One car in the timing tower: position box, entry chip, name, fastest-lap pip, gap, and lap or status.

**Provide**: `row` (a `StandingRow` from `lib/timing.ts`), `entry`, `focused`, `fastest` (holds the fastest lap), `mode` (`gap` or `interval`), `onFocus`. Desktop rows are `size-row` (28 px), dense rows 24 px for 10 to 12 cars, phone sheet rows `size-row-touch` (44 px).

States:
- **leader**: chalk position box, gap column reads LEADER (WINNER once finished).
- **focused**: `surface-400` fill and a `line-control` inner outline. The camera follows this car.
- **fastest lap**: `timing-fastest` pip between name and gap; it moves when the record changes.
- **lapped**: `+1 LAP` in `text-200`.
- **penalty pending**: `status-warn-tint` row and a `+5s` badge in the lap column.
- **just retired**: `status-dnf-tint` for 3 s, then **out**: position `–`, chip hatched, name `text-300`, gap OUT, DNF badge. Out rows sink to the bottom in retirement order.
- **finished**: chequer glyph in the lap column.
- **long name**: truncates with an ellipsis; the full name is the button's accessible name and title.

- The whole row is a button. Reorders animate with `duration-fast`.
- Never colour the name text with the entry colour; the chip carries it.

Maps to `<TowerRow row entry focused fastest mode onFocus>`.
