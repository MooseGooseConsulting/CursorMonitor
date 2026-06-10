import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

test('local server serves dashboard and safe no-credential API responses', async (t) => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      CURSOR_SESSION_TOKEN: '',
      CURSOR_ADMIN_API_KEY: '',
      ALLOW_TOKEN_FROM_UI: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill());

  await waitForServer(port);

  const home = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Cursor Meter/);

  const appJs = await fetch(`http://127.0.0.1:${port}/app.js`);
  assert.equal(appJs.status, 200);
  assert.match(appJs.headers.get('content-type') || '', /javascript/);

  const health = await fetchJson(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.ok, true);
  assert.equal(health.credentials.hasCredentials, false);
  assert.equal(health.config.allowTokenFromUi, false);

  const snapshot = await fetch(`http://127.0.0.1:${port}/api/snapshot?range=today&pageSize=1&maxPages=1`);
  assert.equal(snapshot.status, 401);
  const error = await snapshot.json();
  assert.equal(error.ok, false);
  assert.equal(Object.hasOwn(error, 'cursorPayload'), false);
  assert.equal(JSON.stringify(error).includes('eyJ'), false);
});

async function waitForServer(port) {
  const url = `http://127.0.0.1:${port}/api/health`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Server did not start on ${url}`);
}

async function fetchJson(url) {
  const res = await fetch(url);
  assert.equal(res.ok, true);
  return res.json();
}
