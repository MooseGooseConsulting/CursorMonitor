export function eventsToCsv(events) {
  const rows = [
    ['time', 'model', 'kind', 'charged_dollars', 'total_tokens', 'input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_read_tokens', 'requests_costs', 'is_headless', 'is_chargeable']
  ];
  for (const event of events) {
    rows.push([
      event.isoTime || '',
      event.model,
      event.kind,
      event.chargedDollars == null ? '' : event.chargedDollars.toFixed(6),
      event.tokens.totalTokens,
      event.tokens.inputTokens,
      event.tokens.outputTokens,
      event.tokens.cacheWriteTokens,
      event.tokens.cacheReadTokens,
      event.requestsCosts ?? '',
      event.isHeadless ?? '',
      event.isChargeable ?? ''
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
}

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
