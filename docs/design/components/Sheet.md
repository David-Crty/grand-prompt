# Sheet

The phone's bottom sheet: the full timing tower, the classification, an incident, analysis.

**Provide**: `snap` (`peek`, `half`, `full`), `title`, children.

- Grabber at the top, `radius-4` corners, `shadow-sheet`, scrim at `opacity-scrim` from `half` up.
- Drag between snap points, or tap the grabber; Escape and the back gesture close it.
- The replay keeps playing under a half sheet; full sheets pause it.

Maps to `<Sheet>`.
