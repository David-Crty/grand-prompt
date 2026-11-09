# DeltaChart

Time gained or lost against a reference car along the lap: the clearest answer to "where is the difference?".

Charts share one frame: `chart-grid` lines, `chart-axis` labels in condensed tabular type, sector lines dashed in `line-control`, corner numbers under the x axis, and `chart-cursor` for the focused car's position. Series take entry colours; the focused series is drawn last and thicker, the others thinner, and each series is labelled directly at its end with its code chip, so no legend lookup is needed.

**Provide**: the reference car and comparison cars; deltas come from the best-lap frames (time at equal distance), so the line ends at the lap-time difference.

- Above zero is behind (`delta-behind` tint), below is ahead (`delta-ahead` tint), and both bands are labelled.
- The reference defaults to the race winner; any car can be picked.

Maps to `<DeltaChart>`.
