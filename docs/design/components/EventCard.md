# EventCard

An event in lists (home, standings, model page): circuit thumbnail, circuit and event name, badges, winner with time, and the field as entry bars.

**Provide**: `event` (id, name, track, date, laps, entries, winner, caveats).

- Practice runs never appear as event cards; they group under their build on the model page.
- States: trial (TRIAL badge), draft (owner only: DRAFT outline badge, not published), no finisher ("No finisher" instead of the winner).

Maps to `<EventCard>`.
