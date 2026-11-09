# InputLanes

Throttle and brake for one car's best lap in two labelled lanes, with the reference car as a dashed outline.

Charts share one frame: `chart-grid` lines, `chart-axis` labels in condensed tabular type, sector lines dashed in `line-control`, corner numbers under the x axis, and `chart-cursor` for the focused car's position. Series take entry colours; the focused series is drawn last and thicker, the others thinner, and each series is labelled directly at its end with its code chip, so no legend lookup is needed.

**Provide**: the car, the reference, their best-lap traces.

- Throttle and brake are never overlaid; the lanes keep their labels (THR, BRK).

Maps to `<InputLanes>`.
