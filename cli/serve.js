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
 * Is `target` the directory `root` itself, or something beneath it?
 *
 * Uses path.relative rather than a `root + path.sep` prefix test: that prefix
 * becomes '//' when the served root is the filesystem root, which would reject
 * every valid child.
 */
function isInside(root, target) {
  if (target === root) return true;
  const rel = path.relative(root, target);
  // '' is the root itself; '..'-prefixed is above it; absolute means the two
  // share no common root (different drives on Windows).
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
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
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url === '/' ? '/index.html' : req.url.split('?')[0]);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const filePath = path.resolve(path.join(rootDir, urlPath));
    // Reject paths that escape the served directory lexically ('../' traversal).
    if (!isInside(rootDir, filePath)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const baseHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      // Required for SharedArrayBuffer isolation (FFmpeg.wasm uses COOP/COEP).
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    };

    const serveFile = (resolvedPath) => {
      fs.stat(resolvedPath, (statErr, stat) => { // NOSONAR — resolvedPath passed isInside() both lexically and after realpath
        if (statErr || !stat.isFile()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const total = stat.size;
        const rangeHeader = req.headers['range'];

        const pipeStream = (stream) => {
          stream.on('error', () => { if (!res.writableEnded) res.end(); });
          stream.pipe(res);
        };

        if (rangeHeader) {
          const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
          if (!m) { res.writeHead(416); res.end(); return; }
          let start, end;
          if (!m[1] && !m[2]) {
            // bytes=- with no numbers is invalid
            res.writeHead(416); res.end(); return;
          } else if (!m[1]) {
            // Suffix range: bytes=-N → last N bytes
            start = Math.max(0, total - parseInt(m[2], 10));
            end = total - 1;
          } else {
            start = parseInt(m[1], 10);
            end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
          }
          if (start > end || start >= total) { res.writeHead(416); res.end(); return; }
          res.writeHead(206, { ...baseHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${total}` });
          pipeStream(fs.createReadStream(resolvedPath, { start, end })); // NOSONAR — resolvedPath confined to the served root (see serveFile caller)
        } else {
          res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
          pipeStream(fs.createReadStream(resolvedPath)); // NOSONAR — resolvedPath confined to the served root (see serveFile caller)
        }
      });
    };

    // Resolve symlinks before serving: a link *inside* the tree that points
    // outside it passes the lexical check above, so containment is re-verified
    // against the real path.
    fs.realpath(filePath, (realErr, realPath) => { // NOSONAR — filePath already passed the lexical isInside() check; its real path is re-checked below before any read
      if (realErr) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      if (!isInside(realRoot, realPath)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      serveFile(realPath);
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
