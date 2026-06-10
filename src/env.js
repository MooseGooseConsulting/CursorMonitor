import fs from 'node:fs';
import path from 'node:path';

/**
 * Tiny .env loader to keep this proof-of-concept dependency-free.
 * It supports KEY=VALUE with optional quotes and ignores comments.
 *
 * TODO if you productionize: replace with dotenv, validate with zod/envalid,
 * and add separate config profiles for dashboard vs admin API.
 */
export function loadDotEnv(filePath = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, valueRaw] = match;
    if (process.env[key] !== undefined) continue;
    let value = valueRaw.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function readConfig({ env = process.env, loadEnv = true } = {}) {
  if (loadEnv) loadDotEnv();
  return {
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8787),
    authMode: (env.CURSOR_AUTH_MODE || 'dashboard').toLowerCase(),
    cursorWebBaseUrl: env.CURSOR_WEB_BASE_URL || 'https://cursor.com',
    cursorAdminBaseUrl: env.CURSOR_ADMIN_BASE_URL || 'https://api.cursor.com',
    sessionToken: env.CURSOR_SESSION_TOKEN || '',
    adminApiKey: env.CURSOR_ADMIN_API_KEY || '',
    defaultPageSize: clampInt(env.POLL_DEFAULT_PAGE_SIZE, 1, 10000, 100),
    defaultMaxPages: clampInt(env.POLL_DEFAULT_MAX_PAGES, 1, 200, 3),
    timeoutMs: clampInt(env.REQUEST_TIMEOUT_MS, 1000, 120000, 30000),
    allowTokenFromUi: String(env.ALLOW_TOKEN_FROM_UI || 'false').toLowerCase() === 'true'
  };
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
