#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './env.js';
import { CursorClient, normalizeWorkosToken } from './cursorClient.js';
import { eventsToCsv } from './csv.js';
import { createLogger, redactForLog } from './logger.js';
import { normalizeSummary, rangeToWindow, summarizeEvents } from './metrics.js';
import { methodNotAllowed, readJsonBody, sendJson, sendText, serveStatic } from './httpUtil.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '..', 'public');

const config = readConfig();
let runtimeSessionToken = config.sessionToken;
const logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });
const client = new CursorClient(config, () => runtimeSessionToken || config.sessionToken, logger);

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const requestUrl = new URL(req.url, `http://${config.host}:${config.port}`);
  res.once('finish', () => {
    logger.info('request', {
      method: req.method,
      path: requestUrl.pathname,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  try {
    // Local dev CORS only. This lets you call from scripts, but don't bind to 0.0.0.0.
    res.setHeader('Access-Control-Allow-Origin', `http://${config.host}:${config.port}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      await routeApi(req, res, requestUrl);
      return;
    }

    if (!serveStatic(publicDir, req, res)) {
      sendText(res, 404, 'Not found');
    }
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const message = err.url
      ? `Cursor API request failed with HTTP ${statusCode}.`
      : err.message;
    logger.error('request_failed', {
      method: req.method,
      path: requestUrl.pathname,
      statusCode,
      error: redactForLog({
        name: err.name,
        message: err.message,
        url: err.url
      })
    });
    sendJson(res, statusCode, {
      ok: false,
      error: statusCode >= 500 ? 'server_error' : 'request_error',
      message,
      statusCode
    });
  }
});

async function routeApi(req, res, url) {
  if (url.pathname === '/api/health') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return sendJson(res, 200, {
      ok: true,
      app: 'cursor-meter-poc',
      now: new Date().toISOString(),
      config: {
        host: config.host,
        port: config.port,
        authMode: config.authMode,
        cursorWebBaseUrl: config.cursorWebBaseUrl,
        cursorAdminBaseUrl: config.cursorAdminBaseUrl,
        allowTokenFromUi: config.allowTokenFromUi,
        defaultPageSize: config.defaultPageSize,
        defaultMaxPages: config.defaultMaxPages
      },
      credentials: client.describeCredentials()
    });
  }

  if (url.pathname === '/api/token') {
    if (req.method === 'POST') {
      if (!config.allowTokenFromUi) {
        return sendJson(res, 403, {
          ok: false,
          error: 'token_from_ui_disabled',
          message: 'Set ALLOW_TOKEN_FROM_UI=true or put CURSOR_SESSION_TOKEN in .env.'
        });
      }
      const body = await readJsonBody(req, 64 * 1024);
      const token = String(body.token || '').trim();
      if (!token) return sendJson(res, 400, { ok: false, error: 'missing_token' });
      runtimeSessionToken = normalizeWorkosToken(token);
      return sendJson(res, 200, {
        ok: true,
        message: 'Token saved in this Node process memory only. It is not written to disk.',
        credentials: client.describeCredentials()
      });
    }
    if (req.method === 'DELETE') {
      runtimeSessionToken = '';
      return sendJson(res, 200, { ok: true, message: 'In-memory token cleared.' });
    }
    return methodNotAllowed(res, ['POST', 'DELETE']);
  }

  if (url.pathname === '/api/summary') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const rawSummary = await client.getUsageSummary();
    return sendJson(res, 200, { ok: true, summary: normalizeSummary(rawSummary) });
  }

  if (url.pathname === '/api/events') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const params = eventParamsFromUrl(url);
    const rawEvents = await client.fetchUsageEventPages(params);
    const aggregate = summarizeEvents(rawEvents.usageEventsDisplay);
    return sendJson(res, 200, {
      ok: true,
      query: params,
      rawEventsMeta: {
        totalUsageEventsCount: rawEvents.totalUsageEventsCount,
        fetchedEventsCount: rawEvents.fetchedEventsCount,
        pages: rawEvents.pages
      },
      aggregate,
      events: aggregate.recentEvents
    });
  }

  if (url.pathname === '/api/snapshot') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const range = url.searchParams.get('range') || 'today';
    const pageSize = clampInt(url.searchParams.get('pageSize'), 1, 10000, config.defaultPageSize);
    const maxPages = clampInt(url.searchParams.get('maxPages'), 1, 200, config.defaultMaxPages);

    const rawSummary = await client.getUsageSummary();
    const summary = normalizeSummary(rawSummary);

    let startDate;
    let endDate;
    let label;
    if (url.searchParams.has('startDate') || url.searchParams.has('endDate')) {
      startDate = Number(url.searchParams.get('startDate') || 0);
      endDate = Number(url.searchParams.get('endDate') || Date.now());
      label = 'Custom';
    } else {
      const window = rangeToWindow(range, rawSummary);
      startDate = window.startDate;
      endDate = window.endDate;
      label = window.label;
    }

    const rawEvents = await client.fetchUsageEventPages({ startDate, endDate, pageSize, maxPages });
    const aggregate = summarizeEvents(rawEvents.usageEventsDisplay);

    return sendJson(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      query: {
        range,
        label,
        startDate,
        endDate,
        startIso: new Date(startDate).toISOString(),
        endIso: new Date(endDate).toISOString(),
        pageSize,
        maxPages
      },
      credentials: client.describeCredentials(),
      summary,
      rawSummaryKeys: Object.keys(rawSummary || {}),
      eventsMeta: {
        totalUsageEventsCount: rawEvents.totalUsageEventsCount,
        fetchedEventsCount: rawEvents.fetchedEventsCount,
        pages: rawEvents.pages
      },
      aggregate
    });
  }

  if (url.pathname === '/api/export.csv') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    const params = eventParamsFromUrl(url);
    const rawEvents = await client.fetchUsageEventPages(params);
    const aggregate = summarizeEvents(rawEvents.usageEventsDisplay);
    const csv = eventsToCsv(aggregate.recentEvents);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="cursor-usage-events.csv"',
      'Cache-Control': 'no-store'
    });
    return res.end(csv);
  }

  if (url.pathname === '/api/debug/curl-template') {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    // Keep token placeholder only. Do not print your actual token into terminals/logs unnecessarily.
    return sendText(res, 200, `curl -X POST 'https://cursor.com/api/dashboard/get-filtered-usage-events' \\
  -H 'Content-Type: application/json' \\
  -H 'Origin: https://cursor.com' \\
  -H 'Cookie: WorkosCursorSessionToken=YOUR_SESSION_TOKEN' \\
  -d '{"pageSize":100,"page":1}'\n`);
  }

  return sendJson(res, 404, { ok: false, error: 'not_found' });
}

function eventParamsFromUrl(url) {
  const range = url.searchParams.get('range');
  let startDate = url.searchParams.has('startDate') ? Number(url.searchParams.get('startDate')) : undefined;
  let endDate = url.searchParams.has('endDate') ? Number(url.searchParams.get('endDate')) : undefined;
  if (range && !url.searchParams.has('startDate')) {
    const window = rangeToWindow(range, null);
    startDate = window.startDate;
    endDate = window.endDate;
  }
  return {
    startDate,
    endDate,
    pageSize: clampInt(url.searchParams.get('pageSize'), 1, 10000, config.defaultPageSize),
    maxPages: clampInt(url.searchParams.get('maxPages'), 1, 200, config.defaultMaxPages),
    teamId: url.searchParams.get('teamId') || undefined,
    userId: url.searchParams.get('userId') || undefined
  };
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

server.listen(config.port, config.host, () => {
  logger.info('server_started', {
    url: `http://${config.host}:${config.port}`,
    authMode: config.authMode,
    credentialsConfigured: client.describeCredentials().hasCredentials,
    safety: 'Keep this bound to localhost. The token is a bearer credential.'
  });
});
