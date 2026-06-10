#!/usr/bin/env node
import { readConfig } from '../src/env.js';
import { CursorClient } from '../src/cursorClient.js';
import { normalizeSummary, rangeToWindow, summarizeEvents } from '../src/metrics.js';

const range = process.argv[2] || 'today';
const config = readConfig();
const client = new CursorClient(config);

if (!client.hasCredentials()) {
  console.error('Missing credentials. Set CURSOR_SESSION_TOKEN in .env or CURSOR_AUTH_MODE=admin + CURSOR_ADMIN_API_KEY.');
  process.exit(1);
}

const rawSummary = await client.getUsageSummary();
const summary = normalizeSummary(rawSummary);
const window = rangeToWindow(range, rawSummary);
const rawEvents = await client.fetchUsageEventPages({
  startDate: window.startDate,
  endDate: window.endDate,
  pageSize: config.defaultPageSize,
  maxPages: config.defaultMaxPages
});
const aggregate = summarizeEvents(rawEvents.usageEventsDisplay);
console.log(JSON.stringify({ range, window, summary, eventsMeta: rawEvents.pages, aggregate }, null, 2));
