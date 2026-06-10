import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { CursorClient } from '../src/cursorClient.js';
import { readConfig } from '../src/env.js';
import { isPathInside } from '../src/httpUtil.js';
import { redactForLog } from '../src/logger.js';
import { normalizeEvent, summarizeEvents } from '../src/metrics.js';

test('isPathInside rejects sibling paths with the same string prefix', () => {
  const publicDir = path.resolve('C:/tmp/cursor-meter/public');
  const sibling = path.resolve('C:/tmp/cursor-meter/public2/secret.txt');
  const child = path.resolve(publicDir, 'index.html');

  assert.equal(isPathInside(publicDir, child), true);
  assert.equal(isPathInside(publicDir, publicDir), true);
  assert.equal(isPathInside(publicDir, sibling), false);
});

test('redactForLog removes token-like values from nested log data', () => {
  const token = 'user_demo%3A%3Ajwt_demo_placeholder';
  const adminKey = 'cur_admin_placeholder';
  const redacted = redactForLog({
    headers: {
      Cookie: `WorkosCursorSessionToken=${token}`,
      Authorization: `Basic ${adminKey}`
    },
    body: {
      token,
      CURSOR_ADMIN_API_KEY: adminKey,
      nested: ['safe', token]
    }
  });
  const serialized = JSON.stringify(redacted);

  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(adminKey), false);
  assert.match(serialized, /\*\*\*/);
});

test('credential descriptions do not expose secret previews', () => {
  const dashboard = new CursorClient({
    authMode: 'dashboard',
    sessionToken: 'user_demo%3A%3Ajwt_demo_placeholder'
  });
  const admin = new CursorClient({
    authMode: 'admin',
    adminApiKey: 'cur_admin_placeholder'
  });

  assert.equal(dashboard.describeCredentials().hasCredentials, true);
  assert.equal(admin.describeCredentials().hasCredentials, true);
  assert.equal(Object.hasOwn(dashboard.describeCredentials(), 'credentialPreview'), false);
  assert.equal(Object.hasOwn(admin.describeCredentials(), 'credentialPreview'), false);
});

test('default config disables browser token submission', () => {
  const config = readConfig({ env: {}, loadEnv: false });

  assert.equal(config.allowTokenFromUi, false);
});

test('normalized event aggregates do not retain raw Cursor event payloads', () => {
  const rawEvent = {
    timestamp: '1781035200000',
    model: 'claude-test',
    kind: 'USAGE_EVENT_KIND_USAGE_BASED',
    owningUser: 'person@example.com',
    tokenUsage: { inputTokens: 1, outputTokens: 2, totalCents: 3 }
  };

  const normalized = normalizeEvent(rawEvent);
  const aggregate = summarizeEvents([rawEvent]);
  const serialized = JSON.stringify(aggregate);

  assert.equal(Object.hasOwn(normalized, 'raw'), false);
  assert.equal(serialized.includes('person@example.com'), false);
});
