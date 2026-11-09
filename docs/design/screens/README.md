# Screens

Renders of the design canvas. Every number in them is gp-1, re-run from the committed drivers
(`pnpm bench event run gp-1`), at the replay time below. Open the same moment in the viewer with
`?replay=/results/gp-1/race/replay.json.gz&t=<t>&cam=<cam>&car=<id>&play=0` and compare.

Colour note: the renders give slots in `models.json` order (Opus 1, Fable 2, Sonnet 3, Haiku 4, Sol 5, Terra 6,
Astra 7, Luna 8). Until replays carry slots, the viewer resolves them in id order, so the colours per car differ;
layout, codes and every other value should match.

| File | t (s) | Camera | Followed car | What it shows |
| --- | --- | --- | --- | --- |
| `replay/desktop-tv-mid-race.jpg` | 71 | tv | claude-fable-5-1 | Tower with minimap, two DNFs just in, toasts, focus card, timeline markers. |
| `replay/desktop-chase.jpg` | 71 | chase | claude-fable-5-1 | Chase camera, labels on the cars ahead. |
| `replay/desktop-onboard.jpg` | 71 | onboard | claude-fable-5-1 | Onboard camera. |
| `replay/desktop-map.jpg` | 312 | map | claude-fable-5-1 | Map camera: every car labelled, pins where cars went out. |
| `replay/desktop-race-start-ghost.jpg` | 2.5 | tv | gpt-6-astra | Ghost start: translucent pack, pack label with `=` for identical launches, start board. |
| `replay/desktop-incident.jpg` | 47.8 | tv | claude-sonnet-5-5 | Incident replay mode, incident card, active marker, pin. |
| `replay/desktop-finish.jpg` | 489.95 | tv | gpt-6-astra | Winner on the line, fastest-lap and chequered-flag toasts. |
| `replay/desktop-classification.jpg` | end | tv | gpt-6-astra | Final classification with cost (estimates marked), tokens, build time, practice, points. |
| `replay/desktop-analysis.jpg` | 312 | tv | claude-fable-5-1 | Analysis: speed trace, delta to the winner, throttle and brake lanes, sectors. |
| `replay/ghost-start-options.jpg` | 2.5 | | | The four ghost-start options; A plus B is the plan. |
| `replay/phone-tv-mid-race.jpg` | 71 | tv | claude-fable-5-1 | Phone HUD: header, tower strip, one toast, bottom panel. |
| `replay/phone-chase.jpg` | 71 | chase | claude-fable-5-1 | |
| `replay/phone-onboard.jpg` | 71 | onboard | claude-fable-5-1 | |
| `replay/phone-map.jpg` | 312 | map | claude-fable-5-1 | |
| `replay/phone-race-start-ghost.jpg` | 2.5 | tv | gpt-6-astra | Start board in place of the strip, pack label as one row. |
| `replay/phone-incident.jpg` | 35.6 | tv | claude-sonnet-5-5 | Incident sheet; the camera frames the car above it. |
| `replay/phone-finish.jpg` | 489.95 | tv | gpt-6-astra | |
| `replay/phone-classification.jpg` | end | tv | | Result sheet. |
| `replay/phone-analysis.jpg` | 312 | tv | | Analysis sheet, zoomed speed trace. |
| `replay/phone-timing-sheet.jpg` | 71 | tv | claude-fable-5-1 | Full tower as a sheet. |

GPT costs in the renders use a placeholder price (1.25 $ per M input tokens, 10 $ per M output) until
`prices.json` exists.
