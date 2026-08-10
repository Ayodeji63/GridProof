# Public dashboard

The public dashboard at `/` is the live read-only entry point for GridProof.

## Data source

The dashboard loads zones from:

`GET /api/v1/zones`

Each zone includes:

- identity and feeder metadata
- centroid coordinates for map placement
- latest grid status
- latest uptime score in basis points

Realtime `zone.status_changed` socket events can override the latest displayed status for a zone until the next REST refresh.

## Runtime states

The screen now distinguishes these states explicitly:

- loading: shows a live-zone loading message
- API-backed: renders zones and metrics from `GET /zones`
- empty: prompts operators to register providers or ingest evidence
- API error: renders clearly labeled demo fallback data for rehearsal

## Metrics

Dashboard metrics are derived from the current zone set:

- tracked zones
- average uptime across zones with a known score
- zones currently down, including realtime status overrides
