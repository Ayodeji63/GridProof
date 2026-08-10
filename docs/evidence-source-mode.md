# GridProof Evidence Source Mode

`GRIDPROOF_EVIDENCE_MODE` controls which evidence sources the API accepts during a demo run.

| Value | Accepted ingestion endpoints | Use when |
| --- | --- | --- |
| `hybrid` | `POST /api/v1/ingest/telemetry`, `POST /api/v1/ingest/report`, `POST /api/v1/ingest/whatsapp-webhook` | Sensors and human fallback can both be used. This is the default. |
| `sensor` | `POST /api/v1/ingest/telemetry` only | ESP32 telemetry is the locked-in demo path. |
| `reporter` | `POST /api/v1/ingest/report`, `POST /api/v1/ingest/whatsapp-webhook` only | Hardware is unavailable and the human-reporter fallback is the locked-in demo path. |

If a disabled source is called, the API returns `403` with `EVIDENCE_SOURCE_DISABLED`. If the environment value is invalid, ingestion fails loudly with `EVIDENCE_MODE_INVALID` so a typo cannot silently change the evidence policy.

This switch only gates source ingestion. Downstream detection, AI/reviewer handling, epoch scoring, proof commitments, alerts, and realtime updates continue to consume the same normalized `EvidenceEvent` shape regardless of source.
