import assert from 'node:assert/strict';
import test from 'node:test';
import { eventsToCsv } from '../src/csv.js';

test('eventsToCsv emits a stable escaped usage-event CSV shape', () => {
  const csv = eventsToCsv([{
    isoTime: '2026-06-10T00:00:00.000Z',
    model: 'model, with comma',
    kind: 'USAGE_EVENT_KIND_USAGE_BASED',
    chargedDollars: 1.2345678,
    tokens: {
      totalTokens: 100,
      inputTokens: 10,
      outputTokens: 20,
      cacheWriteTokens: 30,
      cacheReadTokens: 40
    },
    requestsCosts: 2,
    isHeadless: false,
    isChargeable: true
  }]);

  assert.match(csv, /^time,model,kind,charged_dollars,total_tokens,input_tokens,output_tokens,cache_write_tokens,cache_read_tokens,requests_costs,is_headless,is_chargeable\n/);
  assert.match(csv, /"model, with comma"/);
  assert.match(csv, /1\.234568/);
  assert.equal(csv.endsWith('\n'), true);
});
