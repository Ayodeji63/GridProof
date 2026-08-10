# GridProof Ingestion Rate Limits

GridProof applies a fixed-window rate limit before telemetry/report payloads are accepted:

| Route | Primary identity | Fallback |
| --- | --- | --- |
| `POST /api/v1/ingest/telemetry` | `deviceId` | request IP |
| `POST /api/v1/ingest/report` | `reporterWallet` | request IP |
| `POST /api/v1/ingest/whatsapp-webhook` | `reporterWallet`, then `fromPhone` | request IP |

`POST /api/v1/ingest/report` is also protected by reporter-or-higher bearer auth after the source/mode and rate-limit checks. This keeps anonymous web clients from writing evidence while preserving rate-limit protection for repeated attempts.

Environment knobs:

- `INGEST_RATE_LIMIT_MAX` — allowed requests per window, default `60`.
- `INGEST_RATE_LIMIT_WINDOW_MS` — window size, default `60000`.
- `REDIS_URL` — optional Redis/Upstash-compatible URL. When present outside tests, the limiter stores counters in Redis.
- `REDIS_RATE_LIMIT_TIMEOUT_MS` — Redis command timeout, default `500`.

If Redis is unavailable, the API logs a warning and falls back to an in-memory counter so demo ingestion degrades safely instead of hard-failing. Tests default to the in-memory limiter unless `RATE_LIMIT_USE_REDIS_FOR_TESTS=true`.

429 responses include:

- `error.code = "RATE_LIMITED"`
- `Retry-After`
- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset`

## Timestamp sanity checks

Ingested evidence is also bounded by `observedAt` so a bad device clock or malicious reporter cannot create arbitrarily old or future-dated grid events.

Sensor telemetry must be HMAC-signed in production. If `NODE_ENV=production` and `TELEMETRY_HMAC_SECRET` is missing, `POST /api/v1/ingest/telemetry` fails closed with `TELEMETRY_HMAC_SECRET_REQUIRED` instead of accepting unsigned device input.

Webhook reporter ingestion must also be signed in production. If `NODE_ENV=production` and `WHATSAPP_WEBHOOK_SECRET` is missing, `POST /api/v1/ingest/whatsapp-webhook` fails closed with `WHATSAPP_WEBHOOK_SECRET_REQUIRED`. When the secret is set, the API verifies the `X-Hub-Signature-256` HMAC over the raw JSON body.

- `INGEST_MAX_EVENT_AGE_MS` — maximum age accepted for `observedAt`, default `86400000` (24 hours).
- `INGEST_MAX_CLOCK_SKEW_MS` — maximum future clock skew accepted for `observedAt`, default `300000` (5 minutes).

Out-of-range timestamps return `400` with `error.code = "OBSERVED_AT_OUT_OF_RANGE"`.

For demo replay data, set these values explicitly to match the replay window instead of removing the validation entirely.
