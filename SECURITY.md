# Security

## Reporting a vulnerability

If you discover a security issue, please report it privately by opening a [GitHub Security Advisory](../../security/advisories/new) rather than a public issue.

---

## Environment variables and secret management

All secrets are managed through environment variables — **no secrets are hardcoded in the repository**.

Copy `.env.example` to `.env` and fill in all values before running the app.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AUTH_SECRET` | ✅ | Signs/encrypts Auth.js session tokens. Generate: `openssl rand -base64 32` |
| `AUTH_URL` | ✅ | Public URL of the app (must match Google OAuth redirect URI) |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `CRON_SECRET` | ✅ | Protects `/api/cron/notify`. Generate: `openssl rand -base64 32` |
| `NEXT_PUBLIC_BASE_URL` | ✅ | Public URL used in calendar links inside Slack messages |

> **Client bundle exposure**: only `NEXT_PUBLIC_BASE_URL` is exposed to the browser bundle. All other secrets remain server-side only.

---

## Endpoint access controls

### Authentication-required endpoints

The following endpoints require a valid Google OAuth session (enforced via `getAuthenticatedUserId()`). Unauthenticated requests receive `401`:

- `POST /api/subscribe` — create a block watch
- `GET /api/watches` — list your block watches
- `GET /api/watch/[id]` — view a block watch
- `DELETE /api/watch/[id]` — cancel a block watch
- `GET /api/calendar/[id]` — download a `.ics` calendar event

### Cron endpoint

`GET|POST /api/cron/notify` is protected by a shared secret:

- The request must include `Authorization: Bearer <CRON_SECRET>`.
- **The endpoint returns `401` if `CRON_SECRET` is not set** — it is not optional.
- Vercel Cron passes this header automatically when configured.
- The Railway `cron-notify.sh` script reads `CRON_SECRET` from its environment.

### Public endpoints

- `GET /api/estimate` — block-to-time estimation (read-only, no DB writes)
- `GET /api/time-to-block` — time-to-block estimation (read-only, no DB writes)

These endpoints perform input validation and return errors for invalid inputs. They make only outbound read calls to public RPC nodes.

---

## Slack webhook security

- Slack webhook URLs submitted by users are validated against the expected pattern (`https://hooks.slack.com/services/...`) before they are stored.
- Webhook URLs are never returned in full to the client — the `GET /api/watches` response masks them as `...XXXXXXXX` (last 8 chars only).
- Slack error responses are not propagated to API callers to prevent information leakage.

---

## Security headers

All responses include:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | Baseline policy restricting script/style/font/connect sources; `frame-ancestors 'none'` |

---

## Input validation

- `POST /api/subscribe` validates all user inputs: `targetBlock` must be a positive integer within range, `network` must be a known value, `slackWebhookUrl` must match the Slack webhook URL pattern, and `title`/`timezone` have maximum length constraints.
- Internal error details (database errors, stack traces) are never returned to API callers; only domain-level errors (e.g., "block already reached") are surfaced.

---

## Operational best practices

- **Rotate secrets regularly**: regenerate `AUTH_SECRET`, `CRON_SECRET`, and OAuth credentials periodically.
- **Least-privilege DB user**: the app only needs `SELECT`, `INSERT`, `UPDATE`, `DELETE` on its own tables. The migration user needs `DDL` permissions; runtime does not.
- **Monitor Slack webhook usage**: if you see unexpected Slack notifications, revoke the webhook URL in your Slack workspace and issue a new one.
