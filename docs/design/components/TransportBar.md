# TransportBar

Playback controls along the bottom: play, time, timeline, speed, camera, and toggles for trails, analysis and classification.

**Provide**: `t`, `duration`, `playing`, `speed` (1, 2, 4, 8, 16, 32), `camera`, `toggles`, and the handlers.

- Desktop: one row, `size-transport` tall, inset `space-6` from the screen edges.
- Phone: the bottom panel stacks the focused-car row, the touch timeline, then play, speed and camera as `size-hit` buttons.
- At the end of the session the play button becomes replay (back to 0:00) and the classification opens.
- Loading: the timeline shows a `gp-progress` bar of the download; controls are disabled.

Maps to `<TransportBar>`.
