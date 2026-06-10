# Cursor Meter POC

A local-only proof of concept for tracking Cursor usage/cost with a lightweight two-tier app:

- **Backend:** dependency-free Node.js HTTP server on `127.0.0.1`.
- **Frontend:** static HTML/CSS/JS dashboard.
- **Data source:** Cursor’s personal dashboard JSON endpoints using `WorkosCursorSessionToken`, or optional Cursor Team/Admin API mode.

This is intentionally small and hackable. The personal dashboard endpoints are unofficial and can change without notice.

## Project docs

- [North Star](docs/NORTH_STAR.md): product goals, non-goals, principles, success criteria, and next milestones.
- [Agent stand-up prompt](docs/AGENT_STANDUP_PROMPT.md): copy/paste prompt for another agent to run this exact app for comparison.
- [Notes](NOTES.md): endpoint assumptions and design notes.
- [VS Code extension notes](vscode-extension/README.md): prototype extension setup.

## What this calls

Personal dashboard mode:

```http
GET  https://cursor.com/api/usage-summary
POST https://cursor.com/api/dashboard/get-filtered-usage-events
Cookie: WorkosCursorSessionToken=<WORKOS_CURSOR_SESSION_TOKEN>
Origin: https://cursor.com
```

Optional team/admin mode:

```http
POST https://api.cursor.com/teams/filtered-usage-events
Authorization: Basic <BASE64_CURSOR_ADMIN_KEY>
```

## Quick start

```bash
cd CursorMonitor
cp .env.example .env
# edit .env and paste CURSOR_SESSION_TOKEN=<WORKOS_CURSOR_SESSION_TOKEN>
npm start
```

Open:

```text
http://127.0.0.1:8787
```

The server writes JSON-line logs to stdout for startup, requests, and request failures. Set `LOG_LEVEL=debug`, `info`, `warn`, `error`, or `silent` in `.env`; token-like values are redacted before logging.

You can also set `ALLOW_TOKEN_FROM_UI=true` and paste the token into the web UI. That stores it only in the running Node process memory. The default is `false` so bearer credentials do not pass through browser JavaScript unless you opt in.

## Getting the personal dashboard token

1. Open `https://cursor.com/dashboard/usage` while logged in.
2. Open browser DevTools.
3. Go to **Application** → **Cookies** → `https://cursor.com`.
4. Copy `WorkosCursorSessionToken`.
5. Paste it into `.env`:

```bash
CURSOR_SESSION_TOKEN='<WORKOS_CURSOR_SESSION_TOKEN>'
```

Accepted token formats:

```text
<user_id>%3A%3A<jwt>   # exact cookie value; best
<user_id>::<jwt>       # decoded cookie value
<jwt>                  # raw JWT from Cursor local DB; app tries to infer user id from JWT sub
```

## CLI checks

Fixture smoke test, no real token needed:

```bash
npm run smoke:fixture
```

Real API snapshot:

```bash
npm run snapshot:today
npm run snapshot:cycle
```

Direct curl against local server:

```bash
curl -s 'http://127.0.0.1:8787/api/health' | jq
curl -s 'http://127.0.0.1:8787/api/snapshot?range=today&pageSize=100&maxPages=3' | jq
```

## UI behavior

The dashboard shows:

- Window spend from usage events.
- Number of fetched/deduped events.
- Total tokens.
- Most recent request.
- Current billing-cycle plan counters from summary endpoint.
- On-demand usage from summary endpoint.
- Spend/tokens by model.
- Most expensive recent events.
- CSV export for the currently selected window.

## Important security constraints

- Keep `HOST=127.0.0.1`.
- Do **not** deploy this to a cloud host.
- Do **not** put the token in frontend source code.
- Do **not** commit `.env`.
- Keep `ALLOW_TOKEN_FROM_UI=false` unless you explicitly want the browser form to send the token to the local backend.
- Do **not** copy raw server logs into public issues without reviewing them first, even though token-like values are redacted.
- Assume the session token can access your Cursor dashboard as you.
- If you run this on a work machine, treat the output as potentially sensitive usage/billing data.

## What probably needs finishing locally

- Verify the exact request payload in your own DevTools. The code currently sends:

```json
{
  "startDate": "<unix_ms>",
  "endDate": "<unix_ms>",
  "page": 1,
  "pageSize": 100
}
```

- If your account requires `teamId` or `userId`, add them as query params to `/api/events`, or hard-code them in `src/server.js` after confirming in DevTools.
- If `/api/usage-summary` fails but DevTools shows a different path, change `getUsageSummary()` in `src/cursorClient.js`.
- Add SQLite if you want long-term history and dedupe across runs. Right now, the app aggregates the fetched window only.
- Add desktop notifications when a request exceeds a dollar threshold.
- Package the VS Code/Cursor extension in `vscode-extension/` if you want a status bar instead of this browser dashboard.

## Troubleshooting

### `401` / `403`

Token is missing, expired, malformed, or Cursor changed auth requirements. Re-copy `WorkosCursorSessionToken` from the dashboard.

### `Invalid origin for state-changing request`

The Cursor POST endpoint expects:

```http
Origin: https://cursor.com
```

The backend sets it. If you rewrite the code, keep that header.

### Empty events but summary works

Try:

```text
range=cycle&maxPages=10&pageSize=100
```

Also inspect the Network tab on Cursor’s own usage dashboard and compare the request body. Some accounts may require numeric `teamId` / `userId`.

### Costs look lower/higher than expected

The app prefers `chargedCents`, then `tokenUsage.totalCents`, then parses `usageBasedCosts`. Cursor’s schema has changed before, so inspect one raw event under diagnostics and adjust `parseCents()` in `src/metrics.js` if needed.
