# SessionHeader

Where and when: back link to the event, circuit and session, camera, race clock, playback speed, and the GHOST RACE badge.

**Provide**: `event` (id, link), `track`, `session` (`race` or `qualifying`, laps), `t`, `speed`, `camera`, `ghost` (true for every phase 1 to 4 replay).

- The ghost badge opens a popover: "Each car ran alone on an empty track from the same standing start. The replay overlays the runs; cars do not interact. Gaps compare when each car reached the same distance."
- Phone: the header bar holds back, circuit, lap counter and clock; the camera lives in the bottom panel.

Maps to `<SessionHeader>`.
