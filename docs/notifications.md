# GridProof notifications

GridProof records best-effort notifications for demo-critical events:

- `review.required` → reviewer alert
- `chain.committed` → operator/public chain-status alert

Notifications are intentionally side-effect-light. Delivery failures do not block ingestion, review decisions, proof generation, or chain indexing.

## Outbox

When `DATABASE_URL` is configured, notifications are stored in `notification_outbox` from `infrastructure/migrations/002_notification_outbox.sql`.

Without `DATABASE_URL`, the API stores notifications in memory for local demo runs and tests.

Reviewers and admins can inspect the latest outbox records:

```http
GET /api/v1/admin/notifications
Authorization: Bearer <reviewer|admin JWT>
```

Response:

```json
{
  "notifications": [
    {
      "id": "60455448-ba24-4e5d-8cf9-d1057e1777cf",
      "kind": "review_required",
      "audience": "reviewer",
      "channel": "outbox",
      "title": "Evidence needs reviewer confirmation",
      "message": "Reporter evidence needs confirmation.",
      "payload": {
        "candidateEventId": "c04ac0c9-73b8-49f0-97fd-52c77a38bd77",
        "reason": "Reporter evidence needs confirmation."
      },
      "status": "queued",
      "attempts": 0,
      "lastError": null,
      "createdAt": "2026-08-09T10:00:00.000Z",
      "sentAt": null
    }
  ]
}
```

The web app exposes the same outbox at `/notifications`. It uses the same reviewer/admin bearer token source as the review console:

- `VITE_DEMO_AUTH_TOKEN`
- or `localStorage["gridproof.authToken"]`

## Optional webhook delivery

Set `NOTIFICATION_WEBHOOK_URL` to post each notification to an external delivery layer such as a Slack workflow, WhatsApp/Twilio adapter, email worker, or demo automation endpoint.

Environment variables:

- `NOTIFICATION_WEBHOOK_URL` — optional HTTPS endpoint.
- `NOTIFICATION_WEBHOOK_TOKEN` — optional bearer token sent as `Authorization: Bearer <token>`.
- `NOTIFICATION_WEBHOOK_TIMEOUT_MS` — webhook timeout, default `1500`.

Webhook payloads are the same notification records stored in the outbox.

If the webhook returns a non-2xx response or times out, the outbox record is marked `failed` with `lastError`; core GridProof processing continues.
