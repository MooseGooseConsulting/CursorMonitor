import * as crypto from 'crypto';

export type CursorConfig = {
  token: string;
  pageSize: number;
  maxPages: number;
  timeoutMs?: number;
};

export type NormalizedEvent = {
  id: string;
  timestamp: number | null;
  model: string;
  kind: string;
  chargedCents: number | null;
  totalTokens: number;
  isHeadless: boolean | null;
  isChargeable: boolean | null;
};

export type Snapshot = {
  generatedAt: string;
  range: string;
  summary: any;
  totals: {
    eventCount: number;
    totalCents: number;
    totalDollars: number;
    totalTokens: number;
  };
  byModel: Array<{ model: string; eventCount: number; totalCents: number; totalTokens: number }>;
  recentEvents: NormalizedEvent[];
};

export async function fetchSnapshot(config: CursorConfig, range: string): Promise<Snapshot> {
  const summary = await dashboardFetch(config, 'GET', '/api/usage-summary');
  const { startDate, endDate } = getWindow(range, summary);
  const rawEvents: any[] = [];
  let totalCount: number | null = null;

  for (let page = 1; page <= config.maxPages; page++) {
    const payload = await dashboardFetch(config, 'POST', '/api/dashboard/get-filtered-usage-events', {
      startDate: String(startDate),
      endDate: String(endDate),
      page,
      pageSize: config.pageSize
    });
    const pageEvents = Array.isArray(payload.usageEventsDisplay) ? payload.usageEventsDisplay : [];
    rawEvents.push(...pageEvents);
    if (Number.isFinite(Number(payload.totalUsageEventsCount))) totalCount = Number(payload.totalUsageEventsCount);
    if (pageEvents.length < config.pageSize) break;
    if (totalCount !== null && rawEvents.length >= totalCount) break;
  }

  const events = rawEvents.map(normalizeEvent).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const deduped = dedupe(events);
  const byModel = new Map<string, { model: string; eventCount: number; totalCents: number; totalTokens: number }>();
  let totalCents = 0;
  let totalTokens = 0;

  for (const event of deduped) {
    totalCents += event.chargedCents || 0;
    totalTokens += event.totalTokens || 0;
    const row = byModel.get(event.model) || { model: event.model, eventCount: 0, totalCents: 0, totalTokens: 0 };
    row.eventCount += 1;
    row.totalCents += event.chargedCents || 0;
    row.totalTokens += event.totalTokens || 0;
    byModel.set(event.model, row);
  }

  return {
    generatedAt: new Date().toISOString(),
    range,
    summary,
    totals: {
      eventCount: deduped.length,
      totalCents,
      totalDollars: totalCents / 100,
      totalTokens
    },
    byModel: [...byModel.values()].sort((a, b) => b.totalCents - a.totalCents),
    recentEvents: deduped.slice(0, 50)
  };
}

async function dashboardFetch(config: CursorConfig, method: string, endpoint: string, body?: unknown): Promise<any> {
  const token = normalizeWorkosToken(config.token);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30000);
  try {
    const res = await fetch(`https://cursor.com${endpoint}`, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': `WorkosCursorSessionToken=${token}`,
        'Origin': 'https://cursor.com',
        'Referer': 'https://cursor.com/dashboard',
        'User-Agent': 'Mozilla/5.0 cursor-meter-vscode local-only'
      },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      signal: controller.signal
    });
    const text = await res.text();
    const payload = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(payload.error || payload.message || `Cursor API HTTP ${res.status}`);
    }
    return payload;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Cursor dashboard request timed out after ${config.timeoutMs ?? 30000}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function getWindow(range: string, summary: any): { startDate: number; endDate: number } {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (range === 'hour') return { startDate: now - 60 * 60 * 1000, endDate: now };
  if (range === 'twentyFourHours') return { startDate: now - 24 * 60 * 60 * 1000, endDate: now };
  if (range === 'cycle') {
    const parsed = Date.parse(summary?.billingCycleStart || summary?.startOfMonth || '');
    return { startDate: Number.isFinite(parsed) ? parsed : today.getTime(), endDate: now };
  }
  return { startDate: today.getTime(), endDate: now };
}

function normalizeEvent(e: any): NormalizedEvent {
  const tokenUsage = e.tokenUsage || {};
  const input = asNumber(tokenUsage.inputTokens ?? e.inputTokens);
  const output = asNumber(tokenUsage.outputTokens ?? e.outputTokens);
  const cacheWrite = asNumber(tokenUsage.cacheWriteTokens ?? e.cacheWriteTokens);
  const cacheRead = asNumber(tokenUsage.cacheReadTokens ?? e.cacheReadTokens ?? e.cacheRead);
  const totalTokens = asNumber(tokenUsage.totalTokens ?? e.totalTokens ?? input + output + cacheWrite + cacheRead);
  const chargedCents = firstNumber(e.chargedCents, tokenUsage.totalCents, parseMoneyToCents(e.usageBasedCosts));
  return {
    id: stableId(e),
    timestamp: parseTimestamp(e.timestamp ?? e.eventDate ?? e.date ?? e.createdAt),
    model: e.model || 'unknown',
    kind: e.kind || 'unknown',
    chargedCents,
    totalTokens,
    isHeadless: e.isHeadless == null ? null : Boolean(e.isHeadless),
    isChargeable: e.isChargeable == null ? null : Boolean(e.isChargeable)
  };
}

function dedupe(events: NormalizedEvent[]): NormalizedEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function normalizeWorkosToken(input: string): string {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.includes('%3A%3A')) return value;
  if (value.includes('::')) return value.replace('::', '%3A%3A');
  if (looksLikeJwt(value)) {
    const userId = extractUserIdFromJwt(value);
    if (userId) return `${userId}%3A%3A${value}`;
  }
  return value;
}

function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function extractUserIdFromJwt(jwt: string): string {
  try {
    const [, payloadPart] = jwt.split('.');
    const json = Buffer.from(base64UrlToBase64(payloadPart), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    const sub = String(payload.sub || '');
    if (!sub) return '';
    const pieces = sub.split('|');
    return pieces[pieces.length - 1] || '';
  } catch {
    return '';
  }
}

function base64UrlToBase64(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return padded + '='.repeat((4 - (padded.length % 4)) % 4);
}

function stableId(event: any): string {
  return crypto.createHash('sha1').update(JSON.stringify({
    timestamp: event.timestamp,
    model: event.model,
    kind: event.kind,
    chargedCents: event.chargedCents,
    tokenUsage: event.tokenUsage
  })).digest('hex');
}

function parseTimestamp(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 10_000_000_000 ? n * 1000 : n;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoneyToCents(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === '-') return null;
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n * 100 : null;
}
function asNumber(value: unknown): number { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function firstNumber(...values: Array<unknown>): number | null {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
