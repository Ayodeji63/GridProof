# Zone detail and timeline

The Zone Detail screen exposes the feeder timeline required by the GridProof MVP.

## API

`GET /api/v1/zones/:id/history`

The response uses the shared `ZoneHistoryResponse` contract:

- `zone`: feeder metadata, zone key, region, and centroid
- `candidates`: recent outage/restoration candidates, newest first
- `epochScores`: recent epoch uptime scores, newest first
- `trend`: advisory zone health trend, one of `improving`, `stable`, or `declining`, computed from recent epoch-score moving averages

## Web UI

The React route `/zones/:zoneId` renders:

- feeder metadata and coordinates
- health trend summary
- candidate outage/restoration timeline with confidence and supporting evidence IDs
- epoch score list with uptime percentages, evidence hashes, and proof links
- empty states for zones that have no candidates or epoch scores yet

The public dashboard links from its selected feeder card to `/zones/:zoneId`, then each epoch score links onward to `/proof/:zoneId/:epoch`.
