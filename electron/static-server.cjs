const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

function send(response, statusCode, body = '') {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function pathIsWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function createAssetServer(assetDirectory, onResponse = () => {}) {
  const root = fs.realpathSync(assetDirectory);
  const server = http.createServer((request, response) => {
    response.once('finish', () => onResponse({ method: request.method, url: request.url, status: response.statusCode }));
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      send(response, 405, 'Method not allowed');
      return;
    }

    let requestedPath;
    try {
      requestedPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      send(response, 400, 'Malformed request path');
      return;
    }

    const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
    const candidate = path.resolve(root, relativePath);
    if (!pathIsWithinRoot(root, candidate)) {
      send(response, 404, 'Not found');
      return;
    }

    let target;
    let stat;
    try {
      target = fs.realpathSync(candidate);
      stat = fs.statSync(target);
    } catch {
      send(response, 404, 'Not found');
      return;
    }
    if (!pathIsWithinRoot(root, target) || !stat.isFile()) {
      send(response, 404, 'Not found');
      return;
    }

    const contentType = CONTENT_TYPES.get(path.extname(target).toLowerCase()) || 'application/octet-stream';
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': stat.size,
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'Content-Type': contentType,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(target).pipe(response);
  });
  return server;
}

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'nisar-docs.asf.alaska.edu' && !url.username && !url.password;
  } catch {
    return false;
  }
}

module.exports = { createAssetServer, isAllowedExternalUrl };
