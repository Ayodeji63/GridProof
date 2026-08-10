# GridProof API Auth & RBAC

GridProof public read routes stay unauthenticated. Reviewer/admin commands require a Supabase-compatible Bearer JWT signed with `SUPABASE_JWT_SECRET` in production, or `GRIDPROOF_DEV_JWT_SECRET` during local development.

The API can also issue demo sessions for the hackathon flow:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

These endpoints issue HS256 JWTs with Supabase-compatible role claims so the same backend verifier, REST API client, and realtime auth path are used everywhere.

The API reads the user role from JWT claims in this order:

1. `app_metadata.role`
2. `user_metadata.role`
3. `role`

Allowed roles are `public`, `reporter`, `reviewer`, and `admin`. Roles are hierarchical for route guards: `admin` may access reviewer routes, but `reporter` may not.

Protected routes:

| Route | Required role | Reason |
| --- | --- | --- |
| `POST /api/v1/ingest/report` | `reporter` or higher | Web reporter submissions are user-authenticated fallback evidence writes. |
| `POST /api/v1/providers` | `reporter` or higher | Provider registration binds a wallet and zone before self-service on-chain registration. |
| `GET /api/v1/admin/review-queue` | `reviewer` or `admin` | Human-in-the-loop evidence review exposes escalated agent decisions. |
| `POST /api/v1/admin/review/:id/decision` | `reviewer` or `admin` | Reviewer resolution can approve evidence for chain commitment. |
| `POST /api/v1/chain/submit-pending` | `admin` | Internal relayer action that may submit pending commitments to BOT Chain. |
| `POST /api/v1/chain/index-confirmations` | `admin` | Internal indexer action that reconciles pending tx receipts into confirmed/failed commitments. |

Public routes:

- `GET /api/v1/health`
- `GET /api/v1/metrics`
- `GET /api/v1/readiness`
- `GET /api/v1/zones`
- `GET /api/v1/zones/:id/history`
- `GET /api/v1/chain/proof/:zoneId/:epoch`
- `GET /api/v1/providers`
- `GET /api/v1/auth/me` returns `user: null` without a token and the current user with a valid token.
- `POST /api/v1/auth/register` creates a local/Supabase-mirror demo user and returns `{ user, token, expiresAt }`.
- `POST /api/v1/auth/login` returns a fresh token for an already registered demo user.
- Sensor telemetry remains device-authenticated by HMAC payload validation.
- WhatsApp webhook ingestion remains provider/webhook-authenticated by HMAC signature verification in production, payload validation, and rate limiting, not dashboard session RBAC.

## Browser CORS policy

The API uses an explicit browser CORS allowlist:

- `CORS_ORIGINS` — comma-separated list of deployed frontend origins, for example `https://gridproof.example,https://demo.gridproof.example`.
- `CORS_ORIGIN` — legacy single-origin alias accepted for local compatibility.

Production startup fails if no CORS allowlist is configured. Wildcard origins are rejected; server-to-server requests without an `Origin` header remain usable for health checks, scripts, and internal workers.

## Demo registration policy

Reporter registration is open so the fallback human-reporting path works during a live demo:

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "phoneOrEmail": "reporter@gridproof.test",
  "role": "reporter"
}
```

Reviewer/admin registration requires `GRIDPROOF_AUTH_INVITE_CODE` to be configured and supplied as `inviteCode`. This prevents the demo endpoint from becoming an open admin-token mint:

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "phoneOrEmail": "reviewer@gridproof.test",
  "role": "reviewer",
  "inviteCode": "<GRIDPROOF_AUTH_INVITE_CODE>"
}
```

With `DATABASE_URL`, users are stored in Postgres and `phone_or_email` is unique. Without `DATABASE_URL`, the API uses an in-memory user store for local demos/tests. Registration appends a `user.registered` audit record.

Frontend token source:

- `apps/web` sends `Authorization: Bearer <token>` when either `VITE_DEMO_AUTH_TOKEN` is set or `localStorage["gridproof.authToken"]` exists.
- The realtime Socket.io client sends the same token in the connection `auth` payload so reviewer sockets can join the reviewer-only room.
- The Settings screen at `/settings` lets demo operators register/login demo sessions, paste/save/clear a local bearer JWT, and validate the active token with `GET /api/v1/auth/me`.
- If `VITE_DEMO_AUTH_TOKEN` is set, it takes precedence over localStorage for API and realtime calls. The Settings screen shows this so a local token does not appear to be ignored mysteriously.
- This remains a demo/local bridge until full Supabase-hosted sign-in is enabled; the backend still verifies JWT signature, temporal claims, and role claims server-side.
