# SpeedTrace

Best-lap speed against distance for selected cars, with sectors and corner numbers.

Charts share one frame: `chart-grid` lines, `chart-axis` labels in condensed tabular type, sector lines dashed in `line-control`, corner numbers under the x axis, and `chart-cursor` for the focused car's position. Series take entry colours; the focused series is drawn last and thicker, the others thinner, and each series is labelled directly at its end with its code chip, so no legend lookup is needed.

**Provide**: `traces` (per car: `s`, speed in km/h from the best lap's frames), `track` (sectors, corners), `focusId`, `cursor` (s of the focused car), optional `zoom` (a range of s; pinch on phones).

- Up to four series by default (the focused car plus three picked in the legend); more becomes unreadable.

Maps to `<SpeedTrace>`.
