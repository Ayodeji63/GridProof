# GridProof WhatsApp Webhook Ingestion

`POST /api/v1/ingest/whatsapp-webhook` is the fallback human-reporter ingestion path. It accepts a normalized webhook payload and converts it into the same reporter evidence shape used by `POST /api/v1/ingest/report`.

The endpoint is accepted when `GRIDPROOF_EVIDENCE_MODE` is `reporter` or `hybrid`. In `sensor` mode, it returns `EVIDENCE_SOURCE_DISABLED`; see [`evidence-source-mode.md`](evidence-source-mode.md).

In production, set `WHATSAPP_WEBHOOK_SECRET`. The API verifies `X-Hub-Signature-256: sha256=<hex>` against the raw JSON body before accepting the report. If `NODE_ENV=production` and the secret is missing, the route fails closed with `WHATSAPP_WEBHOOK_SECRET_REQUIRED`.

Example payload:

```json
{
  "source": "whatsapp_cloud",
  "messageId": "wamid-demo-1",
  "fromPhone": "+2348012345678",
  "reporterWallet": "0x1111111111111111111111111111111111111111",
  "zoneId": "8a27f3e2-2608-4a88-b8db-efce68be2a59",
  "observedAt": "2026-08-09T10:00:00.000Z",
  "text": "Power is back on my street"
}
```

Mapping:

- `idempotencyKey = whatsapp:<source>:<messageId>`
- `reporterWallet` becomes the evidence provider wallet.
- `text` becomes the reporter note with source/phone context.
- `status` can be supplied explicitly. If omitted, the API infers:
  - outage terms such as `no power`, `no light`, `outage`, `blackout`, `off` → `grid_down`
  - restoration terms such as `back`, `restored`, `power is on` → `grid_up`
  - otherwise → `unknown`

The endpoint uses the same rate limiter as other ingestion endpoints, keyed by `reporterWallet` and falling back to `fromPhone`/IP if needed.
