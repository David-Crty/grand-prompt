# Design handoff

The viewer, the results pages and the video follow the Grand Prompt design system. This folder is its copy in
the repository, so work on the UI needs nothing outside it. Read it before touching `apps/viewer` or `apps/video`.

| Path | What |
| --- | --- |
| `BRAND.md` | The brand book: principles, voice, colour, type, layout, motion, the 3D scene, states, accessibility. |
| `../../packages/ui/tokens.json` | The tokens: the one source for colours, type, spacing, radii, shadows, motion. Not copied here. |
| `components/*.md` | One guide per component: what it is for, what to provide, states, do and don't, the React name. |
| `components/ui-contract.d.ts` | Props of every component, as the contract for `packages/ui` (documentation, not compiled). |
| `reference.css` | The reference styling of every component (class prefix `gp-`), as drawn in the screens. Port it to `packages/ui`; do not import it. |
| `icons/`, `logos/` | The 16 px stroke icon set, the timeline markers, the mark, wordmarks and favicon (drawn in chalk). |
| `screens/` | Renders of the designed screens at 1600×900 and 390×844 (phone at 2×), with the replay time each shows. |
| `PLAN-replay-viewer.md` | The replay viewer work, phase by phase, with what each phase must match. |

The live versions (private to the owner): the design system and the design canvas on claude.ai, and the
proposals doc that the plan comes from. When they and this folder disagree, update this folder in the same
change that implements the difference.

Rules that hold everywhere:

- Values come from tokens: `@bench/ui/tokens.css` in the DOM, `COLORS` / `VALUES` from `@bench/ui` in three.js and
  Remotion. No hex in components. `make tokens` regenerates both after editing `tokens.json`; a test fails while
  they are stale, and another checks every contrast floor in `BRAND.md`.
- A car is identified by its entry (`resolveEntries` in `@bench/ui`): code, colour slot, provider body. Never by
  `car.color` alone.
- What viewers see is what was timed (constraint 2): ghosts, labels and panels explain overlaps; nothing moves a car.
- Logic stays in pure modules under `apps/viewer/src/lib` or `packages/*/src` with tests (the 90% gate);
  components stay presentational.
