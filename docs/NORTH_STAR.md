# Cursor Meter North Star

## North Star

Cursor Meter should be the small local instrument panel that makes Cursor usage understandable while work is happening. It should answer one practical question quickly: "What is my Cursor usage doing right now, and should I change behavior before cost or quota surprises me?"

The first shape is a lightweight local web dashboard. A future shape could be a more visual meter or tower view, but the product center stays the same: local, readable, low-friction visibility into spend, tokens, model mix, and recent expensive requests.

## Goals

- Show a live-ish view of Cursor usage using the smallest dependable local app.
- Keep credentials and usage data local by default.
- Make cost drivers visible by model, request kind, token volume, and recent expensive events.
- Support a fast comparison loop: run the fixture smoke test, run the local server, open the dashboard, and compare against Cursor's own dashboard.
- Preserve enough logging and tests that failures are diagnosable without exposing secrets.
- Provide a clear path from proof of concept to a durable personal tool.

## Non-Goals

- Do not deploy this as a hosted SaaS app.
- Do not store or sync Cursor session credentials remotely.
- Do not scrape rendered dashboard HTML when direct JSON calls are available.
- Do not claim exact billing authority over Cursor's own dashboard.
- Do not build long-term analytics until the current endpoint contract is verified across more accounts.

## Product Principles

- Local first: bind to `127.0.0.1`, keep `.env` out of Git, and prefer in-process or local storage.
- Read-only by default: fetch usage and display it; do not mutate Cursor account state.
- Explainable numbers: every metric should map back to an event field, summary field, or documented fallback.
- Quiet by default: logs should help debugging but redact token-like values.
- Useful before polished: the dashboard should be simple enough to run and inspect before investing in heavier UI or persistence.

## Current Experience

The current app provides:

- A Node HTTP server on `127.0.0.1:8787`.
- A static dashboard with range controls, polling, metric cards, model breakdowns, expensive-event rows, and CSV export.
- Dashboard credential mode using `WorkosCursorSessionToken` or raw JWT-like local Cursor tokens.
- Optional Cursor Admin API mode for team usage endpoints.
- Fixture smoke checks and a small `node --test` suite.
- Structured JSON-line logs with redaction.
- A companion VS Code extension prototype.

## Success Criteria

The proof of concept is useful when:

- A user can stand it up from the README in under five minutes once they have a Cursor token.
- The dashboard loads without exposing the token to the frontend by default.
- The event totals, model rows, and recent expensive events are plausible against Cursor's own dashboard.
- `npm test`, `npm run smoke:fixture`, and the VS Code extension compile all pass.
- Secret scanning reports only placeholders or redaction templates.

## Next Milestones

1. Verify endpoint payloads across several account types.
2. Add a fixture capture workflow that saves sanitized schema samples, not private usage data.
3. Add SQLite persistence for dedupe and trend history.
4. Add threshold alerts for expensive requests or rapid spend changes.
5. Add a compact always-on view, such as a status bar, tray, or tower-style visual meter.
6. Package the VS Code/Cursor extension path once the server/dashboard behavior is stable.

