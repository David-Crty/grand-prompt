# StartBoard

The ghost-start explainer: each car's distance from the line as lanes, for the first seconds of a ghost race while the cars overlap.

**Provide**: `t`, the cars' progress (`progressAt`), `entries`. It shows while the pack spread is under 60 m and `t` is under 15 s, then fades over `duration-slow`; the timeline's start marker brings it back.

- It answers the question the overlapping cars raise ("who launched best?") without moving anything.
- Lanes are sorted by distance; the car mark sits at its distance, the run behind it is the entry colour at 28%.
- Identical launches are named under the lanes ("SON = LUN = TER: identical launch so far").
- Desktop: top-centre under the session header. Phone: it takes the tower strip's place for those seconds.

Maps to `<StartBoard>`; the spread and grouping logic is `lib/pack.ts`.
