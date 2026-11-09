# GapChip

The gap or interval figure in the tower, tables and lower thirds, plus `DeltaChip` for signed comparisons.

**Provide** to `GapChip`: `row` from `liveStandings` (`gap`, `interval`, `lapsDown`, `finished`, `out`, `position`) and `mode` (`gap` or `interval`). It renders `LEADER`, `WINNER`, `INTERVAL` (P1 in interval mode), `+1.832`, `+1 LAP`, `OUT`, or `–` when the gap is unknown (a car not yet at that distance).

**Provide** to `DeltaChip`: `seconds` (signed) and the reference name. Negative is ahead (`delta-ahead`, blue, minus sign), positive behind (`delta-behind`, orange, plus sign). Blue and orange, not green and red, so the split survives red-green colour blindness; the sign repeats the meaning.

- Gaps are three decimals on desktop, one in the phone strip; always tabular and condensed.
- Ghost mode: a gap is the time since the car ahead passed the same distance (`timeGap` in `lib/timing.ts`). Say "virtual gap" in the help text, not in the chip.

Maps to `<GapChip row mode precision>` and `<DeltaChip seconds>`.
