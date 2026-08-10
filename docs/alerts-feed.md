# Public alerts feed

GridProof exposes a public alerts feed for recent agent decisions and their underlying candidate events.

## API

`GET /api/v1/alerts`

Authentication is not required. The endpoint returns recent alert items sorted by decision creation time, newest first.

```json
{
  "alerts": [
    {
      "id": "4f80f256-d4a8-4e51-8d58-ff7b8a605fd2",
      "candidateEventId": "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
      "zoneId": "8a27f3e2-2608-4a88-b8db-efce68be2a59",
      "status": "outage",
      "confidence": 0.95,
      "decision": "approve",
      "hypothesis": "Candidate outage passed deterministic confidence threshold.",
      "supportingEvidenceIds": ["6a670093-7823-44e1-80e4-ac608f9e75bd"],
      "createdAt": "2026-08-09T12:03:00.000Z",
      "candidateCreatedAt": "2026-08-09T12:02:00.000Z"
    }
  ]
}
```

## Source data

Each alert is built from an `agent_decisions` record joined to its `candidate_events` record. In local memory mode, the same shape is produced from the in-process pipeline stores.

The feed includes:

- candidate status: `outage` or `restored`
- agent decision: `approve`, `reject`, or `needs_review`
- confidence and hypothesis
- supporting evidence IDs
- candidate and decision timestamps

## Web UI

The React app renders the public feed at `/alerts`. Each item links to `/proof/:zoneId/latest` so users can jump from an alert to the latest proof for the affected zone.
