# Reporter submission fallback

GridProof supports a human-reporter fallback path for demo zones where ESP32 telemetry is not available.

Reporter ingestion is accepted when `GRIDPROOF_EVIDENCE_MODE` is `reporter` or `hybrid`. In `sensor` mode, the API rejects reporter submissions with `EVIDENCE_SOURCE_DISABLED`; see [`evidence-source-mode.md`](evidence-source-mode.md).

## API

`POST /api/v1/ingest/report`

This web-form endpoint requires `Authorization: Bearer <reporter-or-higher JWT>`. For local demos, create one from Settings with `/auth/register` or `/auth/login`; WhatsApp webhook ingestion remains the external reporter path.

The endpoint accepts the shared `ReporterIngestRequest` shape:

```json
{
  "reporterWallet": "0x1111111111111111111111111111111111111111",
  "zoneId": "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  "idempotencyKey": "web-report:0x1111111111111111111111111111111111111111:2026-08-09T12:03:00.000Z",
  "observedAt": "2026-08-09T12:03:00.000Z",
  "status": "grid_down",
  "note": "Power is out near the transformer."
}
```

Responses use the same `IngestResponse` contract as sensor telemetry:

- `accepted: true`
- `duplicate`: whether the idempotency key had already been processed
- `evidenceEvent`: normalized reporter evidence
- `candidateEvent`: outage/restoration candidate when deterministic rules open one

## Web UI

The React app renders the fallback form at `/report`. The screen:

- collects reporter wallet, zone UUID, grid status, and an optional note
- generates a fresh web-report idempotency key per submission
- posts to `POST /api/v1/ingest/report` with the saved reporter bearer token
- shows whether evidence was accepted, deduplicated, or opened as an outage/restoration candidate

This keeps the demo path unified: reporter evidence enters the same detection, AI/reviewer, alert, and proof pipeline as ESP32 telemetry.
