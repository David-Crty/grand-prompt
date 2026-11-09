# CostScatter

Race time against build cost per entry: the benchmark's value question at a glance.

Charts share one frame: `chart-grid` lines, `chart-axis` labels in condensed tabular type, sector lines dashed in `line-control`, corner numbers under the x axis, and `chart-cursor` for the focused car's position. Series take entry colours; the focused series is drawn last and thicker, the others thinner, and each series is labelled directly at its end with its code chip, so no legend lookup is needed.

**Provide**: entries with race time (or DNF) and cost (reported or estimated).

- Log cost axis. Filled dots are reported cost, hollow dots estimated. Retired cars sit on a DNF row under the plot as crosses.

Maps to `<CostScatter>`.
