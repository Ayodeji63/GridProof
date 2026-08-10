# GridProof Realtime Gateway

The API attaches a Socket.io gateway to the HTTP server. It listens to internal domain events and broadcasts read-only dashboard updates:

| Domain event | Socket event | Audience |
| --- | --- | --- |
| `evidence.received` | `evidence.received` | sockets subscribed to `zone:<zoneId>` |
| `evidence.received` | `zone.status_changed` | all connected dashboards |
| `review.required` | `review.required` | sockets with a valid `reviewer` or `admin` JWT |
| `chain.committed` | `chain.committed` | all connected dashboards and zone subscribers |

Clients subscribe to a zone by passing `query.zoneId` during connection. Reviewer clients pass the same JWT used by REST calls in the Socket.io `auth.token` field.

The React client consumes those events through `useRealtime()`:

- `zone.status_changed` updates the dashboard store immediately and patches the cached `GET /zones` result.
- `chain.committed` invalidates cached zones, zone history, proof explorer, and notification queries so the UI refetches authoritative REST state.
- `review.required` invalidates reviewer queue, alert, and notification queries for reviewer/admin sessions.
- `connect_error` or `disconnect` triggers a REST-query refresh fallback, so the dashboard can recover with normal polling/refetch behavior if the socket is unavailable during a demo.

Realtime is intentionally read-only. All commands still go through REST routes so they remain validated, role-gated, rate-limited, and audit-logged.
