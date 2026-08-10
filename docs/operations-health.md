# Operations health

GridProof keeps observability deliberately lean for the hackathon demo. The public API exposes process health and counters without requiring Prometheus/Grafana.

## APIs

`GET /api/v1/health`

Returns service identity, version, and timestamp.

`GET /api/v1/metrics`

Returns process uptime and pipeline counters:

- evidence ingested
- candidates detected
- agent decisions
- chain submissions
- failures

Counters reset when the API process restarts. They are meant for live demo confidence, not long-term analytics.

`GET /api/v1/readiness`

Returns a redacted deployment-readiness checklist. It reports `ready`, `degraded`, or `not_ready` plus per-category checks for CORS, database, Redis, auth, evidence-mode/signing secrets, BOT Chain relayer configuration, notifications, and observability. Missing environment variable names are shown, but configured secret values, URLs, and keys are never returned.

When required demo configuration is missing, the endpoint returns HTTP `503` with a structured JSON body so machine checks fail while the Operations UI can still show exactly what is missing.

## Web UI

The React app exposes `/operations`, which renders:

- API health state
- service/version/uptime summary
- deployment readiness status and missing environment-variable names
- pipeline counters
- endpoint error states
- a visible warning if the current process has recorded failures

The page refetches health, metrics, and readiness every 30 seconds during demos.

## Optional Sentry capture

GridProof can capture API and browser exceptions to Sentry free tier without making Sentry mandatory for local demos.

API env:

```bash
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
SENTRY_RELEASE=gridproof-api@0.1.0
SENTRY_TRACES_SAMPLE_RATE=0
```

Web env:

```bash
VITE_SENTRY_DSN=
VITE_SENTRY_ENVIRONMENT=development
VITE_SENTRY_RELEASE=gridproof-web@0.1.0
VITE_SENTRY_TRACES_SAMPLE_RATE=0
```

When the DSN is blank, capture is disabled. When configured:

- API 5xx errors are reported from the Express error middleware with method, path, status, and error code.
- Browser `error` and `unhandledrejection` events are reported.
- The React app is wrapped in a Sentry error boundary so render crashes show a fallback instead of a blank page.

Sentry is configured with `sendDefaultPii: false`, and local capture helpers redact obvious secret-bearing context keys such as authorization, token, private key, signature, and secret.
