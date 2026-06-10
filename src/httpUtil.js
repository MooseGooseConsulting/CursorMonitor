import fs from 'node:fs';
import path from 'node:path';

export function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

export function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

export async function readJsonBody(req, maxBytes = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error(`Request body too large. Limit is ${maxBytes} bytes.`);
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    err.statusCode = 400;
    err.message = `Invalid JSON body: ${err.message}`;
    throw err;
  }
}

const MIME_BY_EXT = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon']
]);

export function serveStatic(publicDir, req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(res, 400, 'Bad request');
    return true;
  }
  if (pathname === '/') pathname = '/index.html';

  // Prevent path traversal.
  const safeRelative = pathname.replace(/^\/+/, '');
  const filePath = path.resolve(publicDir, safeRelative);
  if (!isPathInside(publicDir, filePath)) {
    sendText(res, 403, 'Forbidden');
    return true;
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXT.get(ext) || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      sendText(res, 500, 'Unable to read file');
      return;
    }
    res.destroy();
  });
  stream.pipe(res);
  return true;
}

export function isPathInside(rootDir, candidatePath) {
  const root = realpathOrResolved(rootDir);
  const candidate = realpathOrResolved(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function realpathOrResolved(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

export function methodNotAllowed(res, allowed) {
  sendJson(res, 405, { ok: false, error: 'method_not_allowed', allowed }, { Allow: allowed.join(', ') });
}
