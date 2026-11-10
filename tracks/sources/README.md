# Raw track sources

Inputs of `pnpm bench tracks import`, which writes `tracks/<id>.json` for every entry of
`TRACK_SOURCES` in `packages/cli/src/tracks.ts`. Re-run it after changing anything here; a test
checks that it reproduces the committed track files.

| File | Track | Source | License |
|---|---|---|---|
| `tumftm-silverstone.csv` | silverstone | [TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database) `tracks/Silverstone.csv` | LGPL-3.0 (centerline from OpenStreetMap) |
| `tumftm-barcelona.csv` | barcelona | [TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database) `tracks/Catalunya.csv`, fetched 2026-11-09 | LGPL-3.0 (centerline from OpenStreetMap) |
| `tumftm-spa.csv` | spa | [TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database) `tracks/Spa.csv`, fetched 2026-11-11 | LGPL-3.0 (centerline from OpenStreetMap) |
| `osm-monaco.json` | monaco | OpenStreetMap relation 148194 "Circuit de Monaco" | ODbL-1.0, © OpenStreetMap contributors |
| `osm-portimao.json` | portimao | OpenStreetMap relation 7509968 "Algarve International Circuit" | ODbL-1.0, © OpenStreetMap contributors |

The OSM files are raw Overpass API output, fetched on 2026-11-09:

```bash
curl -A "llm-racing-track-import/0.1" --data-urlencode \
  'data=[out:json][timeout:60];relation(148194);out geom;' \
  https://overpass-api.de/api/interpreter > osm-monaco.json
```

A refetch can change the geometry (OSM is edited all the time), and with it the track hash.
