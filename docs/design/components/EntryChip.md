# EntryChip

An entry's colour and three-letter code: the one mark that identifies a car everywhere (tower, labels, tables, charts, video).

**Provide**: `entry` (`{ id, code, slot, name }`), `size` (`s` 18 px default, `l` 24 px, `xl` 40 px for cards and video), `variant` (`fill`, `bar` 4 px colour bar for dense lists, `dot` for maps and legends, `out` hatched for retired cars, `house` dashed outline for the reference driver).

- The fill is the entry token (`entry-01` to `entry-12`); text is always `on-chalk`, condensed 800, uppercase.
- Always render the code, even when the full name is next to it: it is the colour-blind safe identifier.
- Put the full name in `title` and in the accessible name.
- Long names never go in the chip. Names truncate beside it with an ellipsis.
- `EntryName` pairs the chip with the name and the provider line (body swatch + provider text).

States: default, out (retired, `opacity-out` plus hatch), house, unknown slot (falls back to `entry-house`).

Maps to `<EntryChip entry size variant>` and `<EntryName entry meta>`.
