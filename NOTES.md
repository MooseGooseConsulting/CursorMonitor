# Endpoint assumptions and design notes

This POC is based on publicly visible reverse-engineering/forum examples. Verify against your own account in DevTools.

## Current assumptions

- `WorkosCursorSessionToken` can be sent as the only cookie for dashboard auth.
- POST endpoints need `Origin: https://cursor.com`.
- `GET /api/usage-summary` returns billing-cycle counters.
- `POST /api/dashboard/get-filtered-usage-events` accepts `page`, `pageSize`, optional `startDate`, optional `endDate` as millisecond timestamps.
- Response contains `usageEventsDisplay` and often `totalUsageEventsCount`.
- Event costs may appear in one or more of:
  - `chargedCents`
  - `tokenUsage.totalCents`
  - `usageBasedCosts` e.g. `$1.21`

## Why not pure browser HTML?

A static browser page generally cannot set arbitrary `Cookie` headers for `cursor.com`, and Cursor is unlikely to allow cross-origin credentialed requests from a random local file. A local backend avoids CORS and keeps the token off any remote server.

## Why not scrape HTML?

The dashboard's rendered DOM is more brittle than the JSON calls it makes. This app calls the JSON endpoints directly.

## Safer long-term approaches

- If you have team/admin access, use the Cursor Admin API instead of a personal session cookie.
- For a Cursor extension, store the token in VS Code SecretStorage.
- For persistent analytics, store events in SQLite and dedupe by a stable event hash.
