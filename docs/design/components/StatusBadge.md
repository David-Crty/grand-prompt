# StatusBadge

A short uppercase word that states a car's or a result's status. Colour backs the word; the word carries the meaning.

**Provide**: `kind` and the text (or let the kind supply it), optional `icon`.

| kind | text | use |
| --- | --- | --- |
| `dnf` | DNF | retired car, in the tower, tables, cards |
| `warn` | TL 2, +5s, LAP DEL | track-limit warnings, penalties, deleted laps |
| `fin` | FIN | finished (the tower uses the chequer glyph instead) |
| `fastest` | FL | fastest lap holder where there is no pip |
| `ghost` | GHOST RACE | the session header of every ghost-mode replay |
| `trial` | TRIAL | events whose budgets or effort were not equal |
| `est` | EST | after an estimated value (cost) |
| `outline` | any | neutral facts (HOUSE, practice, one-shot) |

- `dnf` and `warn` fills take `on-chalk` text. Never use them for anything but those statuses.
- Use `size="l"` only in cards and video.

Maps to `<StatusBadge kind size icon>`.
