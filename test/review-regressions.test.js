import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eventsToCsv } from '../src/csv.js';
import { CursorClient } from '../src/cursorClient.js';
import { readConfig } from '../src/env.js';
import { isPathInside, serveStatic } from '../src/httpUtil.js';
import { normalizeEvent, summarizeEvents } from '../src/metrics.js';

test('invalid PORT falls back to the default local port', () => {
  const config = readConfig({ env: { PORT: 'abc' }, loadEnv: false });

  assert.equal(config.port, 8787);
});

test('input token split fields are counted together', () => {
  const event = normalizeEvent({
    timestamp: 1781035200000,
    model: 'split-input',
    inputWithCacheWrite: 10,
    inputWithoutCacheWrite: 20,
    outputTokens: 5
  });

  assert.equal(event.tokens.inputTokens, 30);
  assert.equal(event.tokens.totalTokens, 35);
});

test('numeric money fallback values are treated as dollars', () => {
  const event = normalizeEvent({
    timestamp: 1781035200000,
    model: 'numeric-cost',
    usageBasedCosts: 1.23
  });

  assert.equal(event.chargedCents, 123);
  assert.equal(event.chargedDollars, 1.23);
});

test('events without explicit ids are not deduped by synthetic hashes', () => {
  const aggregate = summarizeEvents([
    {
      timestamp: 1781035200000,
      model: 'same-shape',
      kind: 'usage',
      chargedCents: 50,
      tokenUsage: { totalTokens: 100 }
    },
    {
      timestamp: 1781035200000,
      model: 'same-shape',
      kind: 'usage',
      chargedCents: 50,
      tokenUsage: { totalTokens: 100 }
    }
  ]);

  assert.equal(aggregate.totals.eventCount, 2);
  assert.equal(aggregate.totals.totalCents, 100);
});

test('CSV export neutralizes spreadsheet formula prefixes', () => {
  const csv = eventsToCsv([
    {
      isoTime: '2026-06-10T00:00:00.000Z',
      model: '=2+2',
      kind: '@cmd',
      chargedDollars: 1,
      requestsCosts: '',
      isHeadless: false,
      isChargeable: true,
      tokens: {
        totalTokens: 1,
        inputTokens: 1,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0
      }
    }
  ]);

  assert.match(csv, /'=2\+2/);
  assert.match(csv, /'@cmd/);
});

test('malformed static paths return a client error instead of throwing', () => {
  const res = {
    statusCode: null,
    body: '',
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body = '') { this.body = body; }
  };

  const handled = serveStatic('public', { url: '/%E0%A4%A' }, res);

  assert.equal(handled, true);
  assert.equal(res.statusCode, 400);
});

test('frontend source checks delete failures and prevents overlapping refreshes', () => {
  const source = fs.readFileSync('public/app.js', 'utf8');

  assert.match(source, /await deleteJson\('\/api\/token'\)/);
  assert.match(source, /if \(snapshotInFlight\) return;/);
  assert.doesNotMatch(source, /setInterval\(refreshSnapshot,/);
});

test('server exports use billing-cycle summary and full deduped CSV rows', () => {
  const source = fs.readFileSync('src/server.js', 'utf8');

  assert.doesNotMatch(source, /rangeToWindow\(range,\s*null\)/);
  assert.doesNotMatch(source, /eventsToCsv\(aggregate\.recentEvents\)/);
});

test('successful empty event payloads are treated as empty pages', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new CursorClient({
    authMode: 'dashboard',
    sessionToken: 'user_demo%3A%3Ajwt_demo_placeholder',
    cursorWebBaseUrl: 'https://cursor.example.test',
    timeoutMs: 1000
  });

  const result = await client.fetchUsageEventPages({ pageSize: 100, maxPages: 1 });

  assert.deepEqual(result.usageEventsDisplay, []);
  assert.deepEqual(result.pages, [{ page: 1, count: 0, rawKeys: [] }]);
});

test('static file containment follows symlinks when supported', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-meter-static-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const publicDir = path.join(tempDir, 'public');
  const outsideDir = path.join(tempDir, 'outside');
  fs.mkdirSync(publicDir);
  fs.mkdirSync(outsideDir);
  const outsideFile = path.join(outsideDir, 'secret.txt');
  const linkPath = path.join(publicDir, 'linked-secret.txt');
  fs.writeFileSync(outsideFile, 'secret');
  try {
    fs.symlinkSync(outsideFile, linkPath);
  } catch {
    t.skip('symlink creation is unavailable in this environment');
    return;
  }

  assert.equal(isPathInside(publicDir, linkPath), false);
});

test('review source quick wins stay fixed', () => {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const readme = fs.readFileSync('README.md', 'utf8');
  const extensionSource = fs.readFileSync('vscode-extension/src/cursorApi.ts', 'utf8');

  assert.match(html, /<button id="saveTokenBtn" type="button">/);
  assert.match(html, /<button id="clearTokenBtn" class="secondary" type="button">/);
  assert.match(readme, /cd CursorMonitor/);
  assert.match(extensionSource, /AbortError/);
  assert.match(extensionSource, /function looksLikeJwt/);
  assert.match(extensionSource, /function extractUserIdFromJwt/);
});
