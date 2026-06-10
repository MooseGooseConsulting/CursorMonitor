import crypto from 'node:crypto';

/**
 * CursorClient wraps two possible data sources:
 *
 * 1) dashboard mode: unofficial personal dashboard JSON endpoints on cursor.com.
 *    Auth: Cookie: WorkosCursorSessionToken=<token> + Origin for POST.
 *    This is the mode individual Pro/Ultra users are most likely to use.
 *
 * 2) admin mode: official-ish team Admin API endpoints on api.cursor.com.
 *    Auth: Basic <Admin API key>.
 *    This is cleaner if you are a team admin, but probably unavailable for one-person Pro.
 *
 * The personal dashboard endpoints are reverse-engineered and may break. Keep every endpoint
 * configurable, and verify the real network calls in DevTools if this starts failing.
 */
export class CursorClient {
  constructor(config, tokenProvider = () => config.sessionToken, logger = null) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    this.logger = logger;
  }

  get authMode() {
    return this.config.authMode === 'admin' ? 'admin' : 'dashboard';
  }

  hasCredentials() {
    if (this.authMode === 'admin') return Boolean(this.config.adminApiKey);
    return Boolean(this.tokenProvider());
  }

  describeCredentials() {
    if (this.authMode === 'admin') {
      return {
        authMode: 'admin',
        hasCredentials: Boolean(this.config.adminApiKey)
      };
    }
    const token = this.tokenProvider();
    return {
      authMode: 'dashboard',
      hasCredentials: Boolean(token),
      tokenShape: token ? describeTokenShape(token) : null
    };
  }

  async getUsageSummary() {
    if (this.authMode === 'admin') {
      // There is no perfect individual equivalent in Admin API mode. This POC uses events
      // for spend and returns a stub summary. Extend with /teams/spend and /teams/groups if needed.
      return {
        source: 'admin-stub',
        note: 'Admin API mode does not use the personal /api/usage-summary endpoint in this POC.'
      };
    }

    // Reverse-engineered docs mention /api/usage-summary. A marketplace listing mentioned
    // /api/dashboard/usage-summary. Try both; use whichever works.
    const endpoints = ['/api/usage-summary', '/api/dashboard/usage-summary'];
    let lastError;
    for (const endpoint of endpoints) {
      try {
        return await this.#requestDashboardJson('GET', endpoint);
      } catch (err) {
        lastError = err;
        // Only fall back on path-ish failures. Auth failures should surface immediately.
        if (![404, 405].includes(err.statusCode)) throw err;
      }
    }
    throw lastError;
  }

  async getLegacyUsage(userId) {
    if (this.authMode !== 'dashboard') {
      throw new Error('getLegacyUsage is only available in dashboard auth mode.');
    }
    const endpoint = userId ? `/api/usage?user=${encodeURIComponent(userId)}` : '/api/usage';
    return this.#requestDashboardJson('GET', endpoint);
  }

  async getFilteredUsageEvents(params = {}) {
    if (this.authMode === 'admin') {
      return this.#requestAdminJson('POST', '/teams/filtered-usage-events', params);
    }

    // This endpoint is the money endpoint for the personal dashboard.
    // Known request body fields: teamId, userId, startDate, endDate, page, pageSize.
    return this.#requestDashboardJson('POST', '/api/dashboard/get-filtered-usage-events', params);
  }

  async fetchUsageEventPages({ startDate, endDate, pageSize = 100, maxPages = 3, teamId, userId } = {}) {
    const pages = [];
    const events = [];
    let totalUsageEventsCount = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const body = cleanObject({
        teamId,
        userId,
        startDate: startDate == null ? undefined : String(startDate),
        endDate: endDate == null ? undefined : String(endDate),
        page,
        pageSize
      });
      const startedAt = Date.now();
      const payload = await this.getFilteredUsageEvents(body);
      const pageEvents = Array.isArray(payload.usageEventsDisplay)
        ? payload.usageEventsDisplay
        : Array.isArray(payload.usageEvents)
          ? payload.usageEvents
          : Array.isArray(payload.events)
            ? payload.events
            : [];

      pages.push({ page, count: pageEvents.length, rawKeys: Object.keys(payload) });
      this.logger?.info('cursor_events_page', {
        authMode: this.authMode,
        page,
        count: pageEvents.length,
        pageSize,
        totalUsageEventsCount: Number.isFinite(Number(payload.totalUsageEventsCount)) ? Number(payload.totalUsageEventsCount) : null,
        durationMs: Date.now() - startedAt
      });
      events.push(...pageEvents);
      if (Number.isFinite(Number(payload.totalUsageEventsCount))) {
        totalUsageEventsCount = Number(payload.totalUsageEventsCount);
      }

      // Stop early when we fetched everything or hit a short/empty page.
      if (pageEvents.length < pageSize) break;
      if (totalUsageEventsCount != null && events.length >= totalUsageEventsCount) break;
    }

    return {
      totalUsageEventsCount,
      fetchedEventsCount: events.length,
      pages,
      usageEventsDisplay: events
    };
  }

  async #requestDashboardJson(method, endpoint, body) {
    const token = normalizeWorkosToken(this.tokenProvider());
    if (!token) {
      const err = new Error('Missing Cursor session token. Set CURSOR_SESSION_TOKEN or paste it into the local UI.');
      err.statusCode = 401;
      throw err;
    }

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Cookie: `WorkosCursorSessionToken=${token}`,
      Origin: 'https://cursor.com',
      Referer: 'https://cursor.com/dashboard',
      'User-Agent': 'Mozilla/5.0 cursor-meter-poc local-only'
    };

    const url = new URL(endpoint, this.config.cursorWebBaseUrl).toString();
    return this.#requestJsonWithLogging(url, {
      authMode: 'dashboard',
      endpoint,
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      timeoutMs: this.config.timeoutMs
    });
  }

  async #requestAdminJson(method, endpoint, body) {
    if (!this.config.adminApiKey) {
      const err = new Error('Missing Cursor Admin API key. Set CURSOR_ADMIN_API_KEY or switch CURSOR_AUTH_MODE=dashboard.');
      err.statusCode = 401;
      throw err;
    }

    // Cursor examples use Authorization: Basic YOUR_API_KEY. Some Basic implementations
    // expect base64(username:password); this endpoint has been observed accepting the key
    // as the Basic token directly. If your DevTools/docs show a different shape, change this line.
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${this.config.adminApiKey}`,
      'User-Agent': 'Mozilla/5.0 cursor-meter-poc local-only'
    };

    const url = new URL(endpoint, this.config.cursorAdminBaseUrl).toString();
    return this.#requestJsonWithLogging(url, {
      authMode: 'admin',
      endpoint,
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      timeoutMs: this.config.timeoutMs
    });
  }

  async #requestJsonWithLogging(url, options) {
    const startedAt = Date.now();
    try {
      const payload = await requestJson(url, options);
      this.logger?.info('cursor_request', {
        authMode: options.authMode,
        method: options.method,
        endpoint: options.endpoint,
        ok: true,
        durationMs: Date.now() - startedAt
      });
      return payload;
    } catch (err) {
      this.logger?.warn('cursor_request', {
        authMode: options.authMode,
        method: options.method,
        endpoint: options.endpoint,
        ok: false,
        statusCode: err.statusCode || null,
        durationMs: Date.now() - startedAt,
        message: err.message
      });
      throw err;
    }
  }
}

export async function requestJson(url, { method = 'GET', headers = {}, body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { rawText: text.slice(0, 2000) };
    }

    if (!response.ok) {
      const err = new Error(extractCursorError(payload) || `Cursor API returned HTTP ${response.status}`);
      err.statusCode = response.status;
      err.payload = payload;
      err.url = url;
      throw err;
    }
    return payload;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Timed out calling ${url} after ${timeoutMs}ms`);
      timeoutErr.statusCode = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function extractCursorError(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return payload.error || payload.message || payload.detail || null;
}

function cleanObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

/**
 * Accept a few token formats:
 * - user_...%3A%3AeyJ...   exact WorkosCursorSessionToken cookie value
 * - user_...::eyJ...       decoded variant; normalize to cookie shape
 * - eyJ...                 raw JWT from local Cursor DB; infer user id from JWT sub
 */
export function normalizeWorkosToken(input) {
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

export function describeTokenShape(input) {
  const value = String(input || '').trim();
  if (!value) return 'empty';
  if (value.includes('%3A%3A')) return 'workos-cookie-encoded';
  if (value.includes('::')) return 'workos-cookie-decoded';
  if (looksLikeJwt(value)) return 'raw-jwt';
  return 'unknown';
}

function looksLikeJwt(value) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

function extractUserIdFromJwt(jwt) {
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

function base64UrlToBase64(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return padded + '='.repeat((4 - (padded.length % 4)) % 4);
}

export function redactSecret(value) {
  const s = String(value || '');
  if (s.length <= 12) return '***';
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

export function stableEventId(event) {
  const relevant = {
    timestamp: event.timestamp ?? event.eventDate ?? event.date ?? event.createdAt,
    model: event.model,
    kind: event.kind,
    requestsCosts: event.requestsCosts,
    usageBasedCosts: event.usageBasedCosts,
    chargedCents: event.chargedCents,
    tokenUsage: event.tokenUsage
  };
  return crypto.createHash('sha1').update(JSON.stringify(relevant)).digest('hex');
}
