# Cursor Meter VS Code/Cursor extension skeleton

This is an optional companion to the local web app. It stores the `WorkosCursorSessionToken` in VS Code SecretStorage and calls the same unofficial Cursor dashboard JSON endpoints directly from the extension host.

## Run in Extension Development Host

```bash
cd vscode-extension
npm install
npm run compile
# Open this folder in Cursor/VS Code, press F5
```

Then run:

```text
Cursor Meter: Set Session Token
Cursor Meter: Refresh
```

## Package locally

```bash
npm run package
```

Install the resulting `.vsix` into Cursor.

## Things to finish

- Add automatic token extraction from Cursor's local SQLite state database if you want zero manual copy/paste.
- Add a proper tree view/sidebar instead of a simple webview panel.
- Persist historical events locally if you want trends.
- If Cursor changes the dashboard endpoint, update `src/cursorApi.ts`.
