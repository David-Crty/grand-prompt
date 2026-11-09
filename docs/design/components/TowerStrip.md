# TowerStrip

The phone's collapsed tower: the top three plus the focused car, codes only, one-decimal gaps. Tapping it opens the full tower in a sheet.

**Provide**: `rows`, `entries`, `focusId`, `top` (default 3), `onExpand`.

- Sits top-left under the header, 6 px padding, `hud-panel-solid`.
- If the focused car is in the top three it is highlighted in place; otherwise a separator and its row follow.
- The last line counts the hidden cars (`+4 more`).
- Retired cars show OUT and a hatched chip; a retired focused car stays visible until the viewer picks another.
- The whole strip is one button (`aria-label="Timing tower, tap to expand"`); rows are not separate targets at this size.

Maps to `<TowerStrip>`.
