const SENSITIVE_KEY_PATTERN = /authorization|cookie|password|secret|token|api.*key/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g;
const WORKOS_COOKIE_PATTERN = /WorkosCursorSessionToken=([^;,\s]+)/gi;
const BASIC_AUTH_PATTERN = /\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const WORKOS_PAIR_PATTERN = /\buser_[A-Za-z0-9._-]+(?:(?:%3A%3A)|::)[A-Za-z0-9._-]+/gi;
const CURSOR_ADMIN_KEY_PATTERN = /\bcur_[A-Za-z0-9_-]{12,}\b/gi;

export function createLogger({ level = 'info', sink = console } = {}) {
  const threshold = levelToNumber(level);

  function write(levelName, message, fields = {}) {
    if (levelToNumber(levelName) < threshold) return;
    const entry = redactForLog({
      level: levelName,
      time: new Date().toISOString(),
      message,
      ...fields
    });
    const line = JSON.stringify(entry);
    if (levelName === 'error') sink.error(line);
    else if (levelName === 'warn') sink.warn(line);
    else sink.log(line);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields)
  };
}

export function redactForLog(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => redactForLog(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, redactSensitiveValue(nested)];
      }
      return [key, redactForLog(nested)];
    }));
  }
  return String(value);
}

function redactSensitiveValue(value) {
  if (value == null || value === '') return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  return '***';
}

function redactString(value) {
  return String(value)
    .replace(WORKOS_COOKIE_PATTERN, 'WorkosCursorSessionToken=***')
    .replace(BASIC_AUTH_PATTERN, '$1 ***')
    .replace(WORKOS_PAIR_PATTERN, 'user_***%3A%3A***')
    .replace(CURSOR_ADMIN_KEY_PATTERN, 'cur_***')
    .replace(JWT_PATTERN, 'eyJ***.***.***');
}

function levelToNumber(level) {
  switch (String(level || '').toLowerCase()) {
    case 'debug':
      return 10;
    case 'info':
      return 20;
    case 'warn':
      return 30;
    case 'error':
      return 40;
    case 'silent':
      return Number.POSITIVE_INFINITY;
    default:
      return 20;
  }
}
