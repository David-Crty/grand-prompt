# Raw track sources

Inputs of `scripts/import-tracks.ts`, which writes `tracks/<id>.json`. Re-run it after changing
anything here: `pnpm tsx scripts/import-tracks.ts`.

| File | Track | Source | License |
|---|---|---|---|
| `tumftm-silverstone.csv` | silverstone | [TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database) `tracks/Silverstone.csv` | LGPL-3.0 (centerline from OpenStreetMap) |
| `osm-monaco.json` | monaco | OpenStreetMap relation 148194 "Circuit de Monaco" | ODbL-1.0, © OpenStreetMap contributors |
| `osm-portimao.json` | portimao | OpenStreetMap relation 7509968 "Algarve International Circuit" | ODbL-1.0, © OpenStreetMap contributors |

The OSM files are raw Overpass API output, fetched on 2026-11-09:

```bash
curl -A "grand-prompt-track-import/0.1" --data-urlencode \
  'data=[out:json][timeout:60];relation(148194);out geom;' \
  https://overpass-api.de/api/interpreter > osm-monaco.json
```

A refetch can change the geometry (OSM is edited all the time), and with it the track hash.
