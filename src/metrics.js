import { stableEventId } from './cursorClient.js';

export function rangeToWindow(range, summary, now = new Date()) {
  const end = now.getTime();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  switch (range) {
    case 'hour':
      return { startDate: end - 60 * 60 * 1000, endDate: end, label: 'Last hour' };
    case 'sixHours':
      return { startDate: end - 6 * 60 * 60 * 1000, endDate: end, label: 'Last 6 hours' };
    case 'day':
    case 'today':
      return { startDate: startOfToday.getTime(), endDate: end, label: 'Today' };
    case 'twentyFourHours':
      return { startDate: end - 24 * 60 * 60 * 1000, endDate: end, label: 'Last 24 hours' };
    case 'cycle': {
      const start = Date.parse(summary?.billingCycleStart || summary?.startOfMonth || '');
      return {
        startDate: Number.isFinite(start) ? start : startOfToday.getTime(),
        endDate: end,
        label: Number.isFinite(start) ? 'Current billing cycle' : 'Current billing cycle (fallback: today)'
      };
    }
    case 'all':
      // Warning: all-time with high maxPages can page a lot. Keep maxPages low initially.
      return { startDate: 0, endDate: end, label: 'All available events' };
    default:
      return { startDate: startOfToday.getTime(), endDate: end, label: 'Today' };
  }
}

export function normalizeSummary(summary = {}) {
  const individual = summary.individualUsage || {};
  const plan = individual.plan || {};
  const onDemand = individual.onDemand || {};
  const teamOnDemand = summary.teamUsage?.onDemand || {};

  return {
    billingCycleStart: summary.billingCycleStart || summary.startOfMonth || null,
    billingCycleEnd: summary.billingCycleEnd || null,
    membershipType: summary.membershipType || summary.plan || null,
    limitType: summary.limitType || null,
    isUnlimited: Boolean(summary.isUnlimited),
    messages: {
      autoModelSelectedDisplayMessage: summary.autoModelSelectedDisplayMessage || null,
      namedModelSelectedDisplayMessage: summary.namedModelSelectedDisplayMessage || null
    },
    plan: {
      enabled: Boolean(plan.enabled),
      used: asNumber(plan.used),
      limit: asNullableNumber(plan.limit),
      remaining: asNullableNumber(plan.remaining),
      included: asNullableNumber(plan.breakdown?.included),
      bonus: asNullableNumber(plan.breakdown?.bonus),
      total: asNullableNumber(plan.breakdown?.total),
      autoPercentUsed: asNullableNumber(plan.autoPercentUsed),
      apiPercentUsed: asNullableNumber(plan.apiPercentUsed),
      totalPercentUsed: asNullableNumber(plan.totalPercentUsed)
    },
    onDemand: {
      enabled: Boolean(onDemand.enabled),
      usedCents: asNullableNumber(onDemand.used),
      limitCents: asNullableNumber(onDemand.limit),
      remainingCents: asNullableNumber(onDemand.remaining)
    },
    teamOnDemand: {
      enabled: Boolean(teamOnDemand.enabled),
      usedCents: asNullableNumber(teamOnDemand.used),
      limitCents: asNullableNumber(teamOnDemand.limit),
      remainingCents: asNullableNumber(teamOnDemand.remaining)
    },
    rawKeys: Object.keys(summary)
  };
}

export function normalizeEvent(event = {}) {
  const tokenUsage = event.tokenUsage || {};
  const inputTokens = asNumber(tokenUsage.inputTokens ?? event.inputTokens ?? event.inputWithCacheWrite ?? event.inputWithoutCacheWrite);
  const outputTokens = asNumber(tokenUsage.outputTokens ?? event.outputTokens);
  const cacheWriteTokens = asNumber(tokenUsage.cacheWriteTokens ?? event.cacheWriteTokens ?? event.inputWithCacheWrite);
  const cacheReadTokens = asNumber(tokenUsage.cacheReadTokens ?? event.cacheReadTokens ?? event.cacheRead);
  const totalTokens = asNumber(
    tokenUsage.totalTokens ??
    event.totalTokens ??
    inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens
  );

  const chargedCents = parseCents(event);
  const timestampMs = parseTimestampMs(event.timestamp ?? event.eventDate ?? event.date ?? event.createdAt);

  return {
    id: event.id || stableEventId(event),
    timestamp: timestampMs,
    isoTime: timestampMs ? new Date(timestampMs).toISOString() : null,
    model: event.model || 'unknown',
    kind: event.kind || 'unknown',
    maxMode: Boolean(event.maxMode),
    isTokenBasedCall: Boolean(event.isTokenBasedCall),
    isChargeable: event.isChargeable == null ? null : Boolean(event.isChargeable),
    isHeadless: event.isHeadless == null ? null : Boolean(event.isHeadless),
    requestsCosts: asNullableNumber(event.requestsCosts ?? event.requestCosts),
    usageBasedCosts: event.usageBasedCosts ?? null,
    cursorTokenFeeCents: asNullableNumber(event.cursorTokenFee),
    chargedCents,
    chargedDollars: chargedCents == null ? null : chargedCents / 100,
    tokens: {
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      totalTokens
    }
  };
}

export function summarizeEvents(rawEvents = []) {
  const normalized = rawEvents.map(normalizeEvent).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const seen = new Set();
  const deduped = [];
  for (const event of normalized) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    deduped.push(event);
  }

  const totals = {
    eventCount: deduped.length,
    chargeableEventCount: 0,
    headlessEventCount: 0,
    totalCents: 0,
    knownCostEventCount: 0,
    totalRequestsCost: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0
  };

  const byModel = new Map();
  const byKind = new Map();

  for (const event of deduped) {
    if (event.isChargeable) totals.chargeableEventCount += 1;
    if (event.isHeadless) totals.headlessEventCount += 1;
    if (event.chargedCents != null) {
      totals.totalCents += event.chargedCents;
      totals.knownCostEventCount += 1;
    }
    totals.totalRequestsCost += event.requestsCosts || 0;
    totals.totalTokens += event.tokens.totalTokens || 0;
    totals.inputTokens += event.tokens.inputTokens || 0;
    totals.outputTokens += event.tokens.outputTokens || 0;
    totals.cacheWriteTokens += event.tokens.cacheWriteTokens || 0;
    totals.cacheReadTokens += event.tokens.cacheReadTokens || 0;

    rollup(byModel, event.model, event);
    rollup(byKind, event.kind, event);
  }

  return {
    totals: {
      ...totals,
      totalDollars: totals.totalCents / 100,
      averageCentsPerEvent: totals.eventCount ? totals.totalCents / totals.eventCount : 0,
      averageTokensPerEvent: totals.eventCount ? totals.totalTokens / totals.eventCount : 0
    },
    byModel: [...byModel.values()].sort((a, b) => b.totalCents - a.totalCents || b.eventCount - a.eventCount),
    byKind: [...byKind.values()].sort((a, b) => b.eventCount - a.eventCount),
    recentEvents: deduped.slice(0, 100),
    mostExpensiveEvents: [...deduped]
      .filter((event) => event.chargedCents != null)
      .sort((a, b) => b.chargedCents - a.chargedCents)
      .slice(0, 25)
  };
}

function rollup(map, key, event) {
  const safeKey = key || 'unknown';
  const current = map.get(safeKey) || {
    key: safeKey,
    eventCount: 0,
    totalCents: 0,
    totalDollars: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalRequestsCost: 0,
    chargeableEventCount: 0,
    headlessEventCount: 0
  };
  current.eventCount += 1;
  current.totalCents += event.chargedCents || 0;
  current.totalDollars = current.totalCents / 100;
  current.totalTokens += event.tokens.totalTokens || 0;
  current.inputTokens += event.tokens.inputTokens || 0;
  current.outputTokens += event.tokens.outputTokens || 0;
  current.cacheWriteTokens += event.tokens.cacheWriteTokens || 0;
  current.cacheReadTokens += event.tokens.cacheReadTokens || 0;
  current.totalRequestsCost += event.requestsCosts || 0;
  if (event.isChargeable) current.chargeableEventCount += 1;
  if (event.isHeadless) current.headlessEventCount += 1;
  map.set(safeKey, current);
}

function parseTimestampMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  const s = String(value);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 10_000_000_000 ? n * 1000 : n;
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCents(event) {
  const tokenUsage = event.tokenUsage || {};
  const direct = firstFiniteNumber(
    event.chargedCents,
    tokenUsage.chargedCents,
    tokenUsage.totalCents,
    event.totalCents,
    event.costCents
  );
  if (direct != null) return direct;

  const usageBased = parseMoneyToCents(event.usageBasedCosts ?? event.cost ?? event.costDisplay);
  if (usageBased != null) return usageBased;

  const tokenCents = firstFiniteNumber(tokenUsage.totalCents, event.cursorTokenFee);
  if (tokenCents != null) return tokenCents;

  return null;
}

function parseMoneyToCents(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (!s || s === '-' || /^included$/i.test(s)) return null;
  const numeric = Number(s.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) return null;
  return numeric * 100;
}

function asNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function asNullableNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
