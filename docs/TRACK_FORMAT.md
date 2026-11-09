# Track file format (version 1)

Types: `TrackFile` in `packages/sim/src/types.ts`. Files live in `tracks/<id>.json`.

```jsonc
{
  "id": "proto-ring",
  "name": "Prototype Ring",
  "version": 1,
  "closed": true,
  "points": [[x, y, widthRight, widthLeft], ...],   // metres, driving order, no duplicate end point
  "sectors": [0.40, 0.73],                           // where sectors 1 and 2 end, fractions of the lap
  "runoff": {
    "default": { "type": "grass", "width": 15 },     // metres from the white line to the barrier
    "zones": [{ "type": "gravel", "width": 25, "side": "right", "from": 0.21, "to": 0.26 }]
  },
  "reverse": false,                                  // optional: drive the point list backwards
  "license": "…", "source": "…"
}
```

The start/finish line is at the first point. Zones may wrap past the line (`from > to`).

## Processing (`Track.fromFile`)

1. Fit a periodic C2 cubic spline (chord-length parameterization) through the points.
2. Resample at uniform arc length, ~2 m spacing (`length / round(length / 2)`). For each sample,
   compute position, heading and curvature from the spline derivatives, and interpolate the
   widths linearly.
3. Kerbs: on the inside of corners where |curvature| > 1/250, extended 12 m each way.
4. Runoff from the default and zones, then clipped so the barrier never reaches past halfway to
   a neighbouring section (anything more than 150 m away along s).
5. The hash is a stable hash of the file. It goes into replays and results.

## Making tracks

- Handmade: describe straights and corners in a script like `scripts/gen-proto-ring.ts`
  (`buildTrack` in `packages/sim/src/track/builder.ts`). Closure is solved automatically.
- Real circuits: `scripts/import-tracks.ts` builds `monaco`, `silverstone` and `portimao` from
  the raw extracts in `tracks/sources/` (see its README for provenance and licenses). TUMFTM
  CSVs (`x_m, y_m, w_tr_right_m, w_tr_left_m`) map directly to `points`. OSM circuit relations
  are chained into a ring, projected to metres around the start node, smoothed and resampled
  (`packages/sim/src/track/import.ts`); OSM has no reliable widths, so those get a constant one.
- List what is available: `pnpm bench tracks`; pick one with `--track <id>`.
- Debug render: `pnpm tsx scripts/track-svg.ts tracks/<id>.json out.svg`.
