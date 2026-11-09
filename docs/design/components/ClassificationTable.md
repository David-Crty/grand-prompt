# ClassificationTable

The final result with the benchmark facts: position, entry, time, gap, best lap, penalties, status, cost, tokens, build time, practice runs used, points.

**Provide**: `classification` (replay), `manifests` (per entry: tokens, cost or none, wall time, practice runs, effort), `prices` (for estimates), `points`.

- Best lap of the race in `timing-fastest`, with its lap number.
- Retired rows: DNF in the position column, status "Crashed · L1 · T2", `text-300`, kept in retirement order.
- Cost: reported values plain; missing values estimated as tokens × list price, shown `≈ $2.89 EST`, with the footnote stating the source and that it ignores cache discounts. Never sum reported and estimated cost without the `≈`.
- Trials: the caveat banner sits above the table.
- Phone: `ResultList` (cards), the table scrolls horizontally only on tablets.
- Empty (no finishers): the table still lists every entry with its status.

Maps to `<ClassificationTable>`.
