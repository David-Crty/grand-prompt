# VideoCard

The four Remotion templates for the 9:16 export (1080 × 1920, designed at 540 × 960 and rendered at 2×): intro, race lower third, highlight callout, final card. 1:1 and 16:9 reuse them with the safe box resized.

**Provide**: the event, the replay, the highlights (`lib/highlights.ts`), and the result.

- Safe box: 64 px top, 96 px bottom, 32 px sides at 540 wide (leaves room for platform UI).
- The field band (all entry colours, in finishing order) opens and closes every video; it is the brand moment.
- Text never sits on bare scenery: lower thirds use `hud-panel-solid`.
- Every frame is a pure function of the replay time: no randomness, no wall clock (constraint 1 holds for video too).

Maps to `IntroCard`, `RaceLowerThird`, `HighlightCallout`, `FinalCard` in `apps/video`.
