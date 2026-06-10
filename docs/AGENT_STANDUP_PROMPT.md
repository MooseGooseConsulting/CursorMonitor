# Agent Stand-Up Prompt

Use this prompt with another coding agent when you want an independent comparison run of this exact project.

```text
You are standing up the public CursorMonitor project exactly as-is for comparison. Do not redesign it, do not rewrite the UI, and do not add features unless the app fails to run and a minimal fix is required.

Repository:
- GitHub: https://github.com/Coldaine/CursorMonitor
- Primary PR branch to compare: codex/import-cursor-meter-poc

Goal:
Run the lightweight local Cursor Meter web app and report what it shows. The expected app is a local-only Node server plus static web dashboard at http://127.0.0.1:8787. It should show Cursor usage spend, fetched events, total tokens, model breakdowns, recent expensive events, and CSV export controls.

Hard safety requirements:
- Do not print, commit, upload, or paste any real Cursor token, cookie, JWT, admin key, .env content, or raw usage event payload.
- Do not bind the server to a public interface. Keep HOST=127.0.0.1.
- Do not deploy this app.
- Keep ALLOW_TOKEN_FROM_UI=false unless explicitly asked to test browser token submission.
- If you create .env, keep it local and confirm it is ignored by Git.

Steps:
1. Clone and enter the project:
   git clone https://github.com/Coldaine/CursorMonitor.git
   cd CursorMonitor
   git checkout codex/import-cursor-meter-poc

2. Inspect the project shape:
   - README.md
   - docs/NORTH_STAR.md
   - package.json
   - src/server.js
   - public/index.html
   - public/app.js

3. Verify the no-credential path:
   npm test
   npm run smoke:fixture

4. If comparing the VS Code extension prototype, run:
   npm install --prefix vscode-extension
   npm run --prefix vscode-extension compile

5. Provide credentials safely. Prefer one of these:
   - Set CURSOR_SESSION_TOKEN in your shell for this process only.
   - Or create a local .env from .env.example and paste CURSOR_SESSION_TOKEN there.
   The token may be a WorkosCursorSessionToken cookie value, a decoded user_id::jwt pair, or a raw JWT-like Cursor access token.

6. Start the web app:
   npm start

7. Open:
   http://127.0.0.1:8787

8. Verify the UI, not just HTTP:
   - The page title should be Cursor Meter POC.
   - The heading should be Cursor Meter.
   - Credential status should say a dashboard or admin credential is configured.
   - The dashboard should show metric cards for window spend, events fetched, total tokens, last request, cycle plan, and on-demand usage.
   - The model table and expensive-events table should populate when events are available.
   - The CSV export link should point to /api/export.csv with the selected range/page settings.

9. Capture a short sanitized report:
   - Commit hash tested.
   - Node version.
   - Test results.
   - Whether the page loaded.
   - Auth mode reported by /api/health, but not any credential value.
   - Event count, total tokens, total dollars, and number of model rows.
   - Any mismatch against Cursor's own dashboard.
   - Any console/server errors with token-like values redacted.

Do not call the work complete until the page is visible in a browser and the app has either populated real metrics or clearly reported why credentials/events were unavailable.
```

## Expected Comparison Baseline

When this project was last verified locally, the app:

- Ran from `npm start` on `127.0.0.1:8787`.
- Loaded the `Cursor Meter POC` dashboard in a browser.
- Used dashboard credential mode with UI token submission disabled.
- Fetched and displayed current-window usage metrics.
- Passed `npm test`, `npm run smoke:fixture`, and `npm run --prefix vscode-extension compile`.
- Had green CodeRabbit, Kilo, and GitGuardian checks on the PR.

