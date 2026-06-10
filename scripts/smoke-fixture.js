#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSummary, summarizeEvents } from '../src/metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const summary = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'sample-summary.json'), 'utf8'));
const events = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'sample-events.json'), 'utf8'));

console.log(JSON.stringify({
  summary: normalizeSummary(summary),
  aggregate: summarizeEvents(events.usageEventsDisplay)
}, null, 2));
