/**
 * serve.js — local HTTP server for viewing race results.
 *
 * Serves a results directory over HTTP with path-traversal protection,
 * byte-range support for media seeking, and COOP/COEP headers for
 * FFmpeg.wasm's SharedArrayBuffer isolation.
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { c } from './colors.js';
import { isPathInside } from './paths.js';

/**
 * Build the paths for results output display.
 * Returns { relResults, relHtml } relative to cwd.
 */
export function buildResultsPaths(resultsDir, cwd = process.cwd()) {
  const relResults = path.relative(cwd, resultsDir);
  const relHtml = path.relative(cwd, path.join(resultsDir, 'index.html'));
  return { relResults, relHtml };
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.mov': 'video/quicktime',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

/**
 * Resolve a request URL to an absolute path inside `dir`.
 * Returns { filePath } on success, or { status, message } to reject
 * (400 for a malformed URL, 403 for a path-traversal attempt).
 */
function resolveServedPath(dir, url) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(url === '/' ? '/index.html' : url.split('?')[0]);
  } catch {
    return { status: 400, message: 'Bad request' };
  }
  const filePath = path.resolve(path.join(dir, urlPath));
  // Reject paths that escape the served directory lexically ('../' traversal).
  if (!isPathInside(dir, filePath)) {
    return { status: 403, message: 'Forbidden' };
  }
  return { filePath };
}

// COOP/COEP are required for SharedArrayBuffer isolation (FFmpeg.wasm).
function buildBaseHeaders(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  };
}

/**
 * Parse an HTTP `Range` header against a known total size.
 * Returns { start, end } for a satisfiable range, or null if unsatisfiable
 * (the caller should respond 416).
 */
function parseByteRange(rangeHeader, total) {
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start;
  let end;
  if (m[1]) {
    start = Number.parseInt(m[1], 10);
    end = m[2] ? Math.min(Number.parseInt(m[2], 10), total - 1) : total - 1;
  } else {
    // Suffix range: bytes=-N → last N bytes
    start = Math.max(0, total - Number.parseInt(m[2], 10));
    end = total - 1;
  }
  if (start > end || start >= total) return null;
  return { start, end };
}

function pipeToResponse(res, stream) {
  stream.on('error', () => { if (!res.writableEnded) res.end(); });
  stream.pipe(res);
}

// Send a file as either a full 200 response or a 206 partial (range) response.
function sendFile(req, res, filePath, stat) {
  const total = stat.size;
  const baseHeaders = buildBaseHeaders(filePath);
  const rangeHeader = req.headers['range'];
  if (!rangeHeader) {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
    pipeToResponse(res, fs.createReadStream(filePath));
    return;
  }
  const range = parseByteRange(rangeHeader, total);
  if (!range) { res.writeHead(416); res.end(); return; }
  res.writeHead(206, {
    ...baseHeaders,
    'Content-Length': range.end - range.start + 1,
    'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
  });
  pipeToResponse(res, fs.createReadStream(filePath, { start: range.start, end: range.end }));
}

/**
 * Create an HTTP request handler that serves static files from `dir`.
 *
 * Security: rejects any path that resolves outside `dir` (path traversal),
 * both lexically and — after resolving symlinks — by real path, so a link
 * inside the served tree cannot expose a file outside it.
 * Range requests: advertises `Accept-Ranges: bytes` and responds with
 * `206 Partial Content` so browsers can seek within media files (WebM, MP4).
 * COOP/COEP headers are required for `SharedArrayBuffer` isolation used by
 * FFmpeg.wasm in the browser player.
 *
 * Exported for testing.
 */
export function createStaticHandler(dir) {
  // Resolve the served root once so the confinement checks compare absolute
  // paths. Comparing a resolved filePath against a relative or
  // trailing-separator `dir` rejected every request with 403.
  const rootDir = path.resolve(dir);
  // The root's own symlinks resolved once (e.g. /tmp -> /private/tmp on macOS),
  // so a realpath'd request path can be compared against it.
  let realRoot;
  try { realRoot = fs.realpathSync(rootDir); } catch { realRoot = rootDir; } // NOSONAR — rootDir is the caller-supplied results dir, not request data

  return (req, res) => {
    const resolved = resolveServedPath(rootDir, req.url);
    if (resolved.status) {
      res.writeHead(resolved.status);
      res.end(resolved.message);
      return;
    }
    const { filePath } = resolved;
    // Resolve symlinks before serving: a link *inside* the tree that points
    // outside it passes the lexical check above, so containment is re-verified
    // against the real path.
    fs.realpath(filePath, (realErr, realPath) => { // NOSONAR — filePath already passed the lexical check in resolveServedPath; its real path is re-checked below before any read
      if (realErr) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      if (!isPathInside(realRoot, realPath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.stat(realPath, (statErr, stat) => { // NOSONAR — realPath re-checked against realRoot above
        if (statErr || !stat.isFile()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        sendFile(req, res, realPath, stat);
      });
    });
  };
}

/**
 * Detect whether the current environment is headless/CI, where auto-opening
 * a browser is likely to fail or be unwanted.
 */
export function isHeadlessEnv() {
  if (process.env.CI) return true;
  if (!process.stderr.isTTY) return true;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return true;
  }
  return false;
}

/**
 * Serve `dir` over HTTP on a random free port, optionally open `index.html`
 * in the browser, and install a SIGINT handler that cleanly closes the
 * server before exiting. Returns the server instance so callers can close it.
 * In headless/CI environments, returns null without starting a server to
 * avoid hanging non-interactive runs.
 */
export function serveResults(dir) {
  if (isHeadlessEnv()) {
    const { relHtml } = buildResultsPaths(dir);
    console.error(`  ${c.cyan}${c.bold}open ${relHtml}${c.reset}`);
    return null;
  }
  // NOSONAR — local-only server for viewing race results; binds to 127.0.0.1
  // with path traversal protection in createStaticHandler
  const server = http.createServer(createStaticHandler(dir));

  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const url = `http://localhost:${port}/`;
    console.error(`  ${c.dim}🌐 Serving at ${c.reset}${c.cyan}${c.bold}${url}${c.reset}`);
    console.error(`  ${c.dim}Press Ctrl+C to stop the server.${c.reset}`);

    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
    const child = spawn(opener[0], opener[1], { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // ignore ENOENT when opener isn't available
    child.unref();
  });

  const shutdown = () => {
    process.stderr.write(c.showCursor);
    server.close(() => process.exit(0));
    // Fallback if server.close hangs on keep-alive connections
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return server;
}
