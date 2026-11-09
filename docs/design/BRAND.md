Grand Prompt is a motorsport benchmark for LLMs. Each model writes a driving program once, every program drives the same car on the same circuit in a deterministic simulator, and the race is replayed in 3D. This system covers everything a viewer sees: the replay HUD, the results pages, the shared-link experience on phones, and the generated videos. It is dark only, built for broadcast readability, and carries no series branding.

## Principles

1. **Read like TV.** In two seconds a viewer knows who is ahead, by how much, and what went wrong. Tower, gaps and race messages beat decoration everywhere.
2. **Colour belongs to the cars.** The chrome is ink and chalk. Hue is reserved for entries (`entry-01` to `entry-12`) and for a short list of signals (fastest, DNF, warning, delta). A colour never means two things.
3. **Show only what was timed.** Cars are drawn exactly where the replay puts them. Overlaps, identical launches and lapped cars are explained with labels, transparency and HUD panels, never by moving a car.
4. **Label every caveat.** `GHOST` for overlaid independent runs, `TRIAL` for events with unequal budgets or effort, `≈ est.` for estimated cost, `HOUSE` for the reference driver. A caveat sits next to the number it qualifies.
5. **Phone first for shared links.** Shared links open on phones. Every screen is designed at 390 px first and grows to 1600 px, not the reverse.

## Voice and content

- Plain, factual, broadcast short. Lead with the result, then the reason. "Claude Sonnet 5.5 spun under full throttle on the exit of Turn 2", not "Disaster for Sonnet!".
- The subject of race copy is the model name, because the reader thinks in models. Explainers say once that each car is a program the model wrote: "Each model wrote one program. Every program raced the same car."
- Uppercase only for broadcast labels (`label`, `display-*` styles, badges, codes). Everything else is sentence case.
- Model names exactly as `models.json` has them: "Claude Fable 5.1", "GPT-6 Astra". Never shorten a provider's product name on its own page; the three-letter code is the short form.
- Codes: three uppercase letters, from the model's given name ("Fable" FAB, "Astra" AST, "Opus" OPU). Collisions add the version digit (SN5, SN6). The owner can override per model.
- Numbers, always tabular:
  - lap and race times `1:38.099`, `8:14.906`; sub-minute `56.501`
  - gaps `+5.057`, intervals the same; `+1 LAP`, `+2 LAPS`; the leader shows `LEADER`, the winner `WINNER`
  - phone strip gaps to one decimal: `+0.5`
  - speed in whole km/h: `298`
  - tokens `1.28M`, `649k`; cost `$3.83`; estimated cost `≈ $2.89 est.`; build time `11m27`
  - deltas always signed: `−0.214` (ahead, `delta-ahead`), `+0.532` (behind, `delta-behind`)
- Incident sentences follow: what happened, where (lap, corner), how fast, what followed. "Spun under throttle out of Turn 2 at 194 km/h and stopped on the grass. Rejoined at 0:56, lost the rear again after Turn 3 and hit the barrier at 106 km/h."
- No emoji, no exclamation marks, no superlatives the data does not prove.

## Colour

One theme, `broadcast`. Grounds step up from `ink-000` (viewer letterbox, video) to `surface-100` (pages), `surface-200` (cards, tables), `surface-300` (raised, hover, plot areas) and `surface-400` (selected, focused row). Over the 3D scene, panels use `hud-panel` (86% opaque) or `hud-panel-solid` where scenery is busy.

Text is `text-100` (chalk) for anything that matters, `text-200` for secondary, `text-300` for column heads and micro labels. All three pass 4.5:1 on every surface and on `hud-panel` over asphalt, grass and sky. Text on chalk or on any entry colour is `on-chalk`, never white.

Signals, each with a word or glyph beside it:

| Token | Means | Never |
| --- | --- | --- |
| `timing-fastest` | overall fastest lap or sector (purple) | an entry colour, decoration |
| `timing-personal` / `timing-slower` | personal best / slower sector | status |
| `status-dnf` | retired, crashed, brake | anything else red |
| `status-warn` | track limits, deleted lap, penalty, trial caveat | success |
| `delta-ahead` / `delta-behind` | faster / slower than the reference car (blue / orange, safe for red-green colour blindness) | green and red |
| `telemetry-throttle` / `telemetry-brake` | throttle and brake lanes, always in separate labelled lanes | overlaid |

### Entry colours

Twelve slots, `entry-01` (blush) to `entry-12` (fuchsia). They were chosen by search over OKLCH for the largest minimum distance under normal vision and simulated protanopia, deuteranopia and tritanopia (Machado 2009), with three constraints: at least 5:1 for `on-chalk` text on the chip, at least 3:1 as a mark on every ground, and no hue in the violet band that `timing-fastest` owns. The first eight stay clearly apart for all four visions; slots 9 to 12 can resemble an earlier slot under colour blindness, so they lean on the code.

- An entry's colour appears on: its chip, its label in the scene, its trail, its tower chip, its map dot, its chart line and its livery stripe. Nowhere else.
- Assignment: each model has a preferred slot in `models.json` (stable across a season). Within one event, slots are unique; a clash falls to the next free slot in slot order. The house driver is `entry-house` (grey, dashed trail).
- More than twelve entries: slots repeat with the outline chip variant, and the code is the only identifier. Design for twelve.
- Every chip carries the three-letter code, so colour is never the only cue.

### Provider body paint

The car's bodywork shows the provider (`body-clay` Anthropic, `body-silver` OpenAI, `body-cobalt` Google, `body-pearl` xAI, `body-saffron` Mistral, `body-graphite` others). These are 3D materials only. Because two cars of one provider share a body, the entry colour rides on a wide livery stripe down the nose and engine cover, plus the rear-wing endplates. In UI, the provider is text plus a small `gp-body-swatch`, never a logo.

### World

`world-*` tokens document the inherited low-poly scene (asphalt, white lines, red and white kerbs, grass bands, gravel, barriers, sky). They are generic motorsport colours, not a series livery. `map-track` draws the minimap ribbon.

## Type

Archivo, one variable file with weight 100 to 900 and width 62 to 125, plus JetBrains Mono for code and hashes. Width carries meaning:

- **Expanded** (`gp-x`, wdth 125, uppercase): broadcast titles, `display-xl`, `display-l`, `display-m`, the wordmark.
- **Normal**: reading text, `title`, `body-l`, `body`, `body-s`, `label`.
- **Condensed** (`gp-c`, wdth 75, tabular): every number and code, `data-xl` to `data-s`, `chip`.

Width is set with `font-variation-settings` through the `gp-x` and `gp-c` classes, so it works with the generated `@font-face`. Tabular numerals are on for the whole `gp` root; columns of times must align to the digit. Minimum sizes: 11 px for labels, 13 px for any number a viewer compares, 15 px body on phones.

## Layout

- **Desktop replay (1600×900)**: tower top-left at `space-6` inset, `size-tower` wide; session header top-right; race messages stack under it, right-aligned; focus card bottom-left above the transport; transport full width at the bottom, `size-transport` tall. The centre third stays clear for the car.
- **Phone replay (390×844)**: header bar 52 px; collapsed tower strip top-left (top three plus the focused car); messages one at a time under the header; the bottom panel holds the focused-car row and the transport, `size-hit` targets. Swiping up opens the full tower as a sheet. The TV camera frames the car in the visible area between the two bands, not the screen centre.
- **Results pages**: 1280 px max content width, `space-10` gutter on desktop, `space-4` on phones, one column below `bp-desktop`. Cards are `surface-200` on `surface-100` with `line-100` borders, no shadow.

## Shape, depth, transparency

Straight edges read as TV graphics: tower rows and broadcast bands are `radius-0`, chips and badges `radius-1`, HUD panels and buttons `radius-2`, cards `radius-3`, the phone sheet's top corners `radius-4`. Depth comes from surface steps; only HUD panels (`shadow-hud`), overlays (`shadow-overlay`) and the sheet (`shadow-sheet`) cast shadows. `blur-hud` is a desktop nicety; phones and video never blur (cost and legibility).

## Motion

`duration-fast` with `easing-standard` for tower reorders and toggles, `duration-base` for panels and toasts, `duration-slow` for overlays. The TV camera never cuts: a focus change pans over `duration-camera`. Race messages stay `duration-toast` at 1× and shorten at higher playback speeds so they never pile up. Under `prefers-reduced-motion`, reorders and pans become instant and skeletons stop shimmering. Video uses the same durations at 30 fps.

## Iconography

A 16 px stroke set (1.6 px stroke, round caps) in the Icons asset group, drawn in chalk; in code they are inline SVG with `currentColor`. Timeline markers are filled 12 px glyphs with fixed meaning: square cross (DNF, `status-dnf`), triangle (warning or penalty, `status-warn`), diamond (fastest lap, `timing-fastest`), chequer (finish), flag (start). The chequer pattern marks a finished car. No emoji, no provider logos, no series marks.

## The 3D scene

- **Labels**: a chip with the position and the code; the focused car's label adds its full name and a chalk ring. Labels stack upward when they collide; the car never moves.
- **Ghost cars**: cars closer than 1.5 car lengths form a pack. The focused car (or, if none is in the pack, the front-most) is drawn solid; the others draw at `opacity-ghost` with an entry-colour rim, and their labels merge into one pack label. Cars at identical positions are joined with `=` and the note "same line".
- **Start board**: for the first seconds of a ghost race, while the pack is tighter than 60 m, a HUD panel shows each car's distance from the line as lanes. It explains the launch without touching the cars.
- **Trails**: entry colour, `opacity-trail` at the head fading to zero; the house driver's trail is dashed.
- **Incident pins**: a `status-dnf` pin and a ground ring at the crash point, also on the minimap and the timeline.

## States

Every component documents empty, loading, error, DNF, many cars (12) and long names. Shared rules: loading shows `gp-skel` shapes in the final layout (no spinners over the scene); errors say what failed and what to do ("This replay was made with sim 0.2; this viewer plays 0.1. Open it with the matching viewer."); missing values are `–`, never 0; estimated values carry `≈` and `est.`; trials carry the caveat banner wherever their result appears.

## Accessibility

Contrast is checked for every text and mark pair on every ground. Focus is a 2 px `focus-ring` outline with 2 px offset. Every control is a real button or link; the timeline is a slider with marker shortcuts. The keyboard map stays (1 to 4 cameras, Tab and brackets for cars, Space, arrows, G T A C H F ?). Touch targets are `size-hit`. Race messages are announced through an `aria-live="polite"` region, throttled to one per two seconds of playback.

## Implementation map

- `packages/ui`: shared by `apps/viewer` and `apps/video`. `tokens.json` (this file's source) generates `tokens.css` for the DOM and `tokens.ts` for three.js materials and Remotion. Component names here are the React export names; class names in `components/bundle.css` are the reference styling.
- Logic stays in pure, tested modules (constraint 8): `lib/entries.ts` (slots, codes, provider bodies), `lib/pack.ts` (ghost packs, identical positions), `lib/incidents.ts` (cause and plain-words sentence from frames), `lib/timeline.ts` (markers, highlight merge), `lib/cost.ts` (reported and estimated cost), `lib/timing.ts` and `lib/format.ts` (existing).
- The HUD reads a typed snapshot from a small store (proposal R3) instead of the mutable `live` ref; the scene keeps the per-frame loop.
