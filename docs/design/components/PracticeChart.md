# PracticeChart

Lap time per practice run, one line per practice circuit: how a model learned during its build.

Charts share one frame: `chart-grid` lines, `chart-axis` labels in condensed tabular type, sector lines dashed in `line-control`, corner numbers under the x axis, and `chart-cursor` for the focused car's position. Series take entry colours; the focused series is drawn last and thicker, the others thinner, and each series is labelled directly at its end with its code chip, so no legend lookup is needed.

**Provide**: the build's practice runs (circuit, run index, best lap, status). Crashed runs plot as a cross on the run axis.

- Circuits are told apart by line style (solid, dashed, dotted) as well as shade, since they all belong to one entry.
- The preview uses illustrative values: practice history lives in `results/agentic`, which the repository does not commit.

Maps to `<PracticeChart>`.
