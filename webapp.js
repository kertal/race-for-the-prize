#!/usr/bin/env node

/**
 * webapp.js — Web UI for browsing and triggering races.
 *
 * Usage:
 *   node webapp.js                  # Start on default port 3000
 *   node webapp.js --port=8080      # Start on custom port
 *
 * Provides:
 *   GET  /                          — Web UI
 *   GET  /api/races                 — List all race directories
 *   GET  /api/races/:name           — Race details (settings, racers, results list)
 *   GET  /api/races/:name/results/:dir          — summary.json for a result
 *   GET  /api/races/:name/results/:dir/files/*  — Static files (videos, JSON, etc.)
 *   POST /api/races/:name/run       — Trigger a new race execution
 */

import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { discoverRacers } from './cli/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACES_DIR = path.join(__dirname, 'races');

const MAX_REQUEST_BODY = 64 * 1024; // 64 KB
const MAX_OUTPUT_BUFFER = 512 * 1024; // 512 KB

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.mov': 'video/quicktime',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// --- Helpers ---

function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function errorResponse(res, message, status = 400) {
  jsonResponse(res, { error: message }, status);
}

/** List subdirectories of a directory. */
function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort();
}

/** List result directories (results-*) inside a race dir, newest first. */
function listResultDirs(raceDir) {
  if (!fs.existsSync(raceDir)) return [];
  return fs.readdirSync(raceDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('results-'))
    .map(d => d.name)
    .sort()
    .reverse();
}

/** Safely resolve a path within a base directory. Returns null if it escapes. */
function safePath(base, ...segments) {
  const resolved = path.resolve(base, ...segments);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

// --- Active race tracking ---
const activeRaces = new Map(); // raceId -> { name, status, output, startTime, process }
let raceIdCounter = 0;

/** Load settings.json and discover racers for a race directory. */
function loadRaceInfo(raceDir) {
  let settings = null;
  const settingsPath = path.join(raceDir, 'settings.json');
  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch { /* ignore */ }

  let racerFiles = [], racerNames = [];
  try {
    ({ racerFiles, racerNames } = discoverRacers(raceDir));
  } catch { /* ignore */ }

  return { settings, racerFiles, racerNames };
}

/** Read a request body with a size limit. Rejects if exceeded. */
function readBody(req, maxBytes = MAX_REQUEST_BODY) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => { if (!aborted) resolve(body); });
    req.on('error', reject);
  });
}

// --- API handlers ---

function handleListRaces(req, res) {
  const raceDirs = listDirs(RACES_DIR);
  const races = raceDirs.map(name => {
    const raceDir = path.join(RACES_DIR, name);
    const { settings, racerNames } = loadRaceInfo(raceDir);
    const resultDirs = listResultDirs(raceDir);
    return { name, racerNames, settings, resultCount: resultDirs.length };
  });

  jsonResponse(res, { races });
}

function handleRaceDetail(req, res, raceName) {
  const raceDir = safePath(RACES_DIR, raceName);
  if (!raceDir || !fs.existsSync(raceDir)) {
    return errorResponse(res, 'Race not found', 404);
  }

  const { settings, racerFiles, racerNames } = loadRaceInfo(raceDir);

  const racerScripts = {};
  for (const f of racerFiles) {
    const name = f.replace(/\.spec\.js$/, '').replace(/\.js$/, '');
    try {
      racerScripts[name] = fs.readFileSync(path.join(raceDir, f), 'utf-8');
    } catch { /* ignore */ }
  }

  const resultDirs = listResultDirs(raceDir);
  const results = resultDirs.map(dir => {
    const summaryPath = path.join(raceDir, dir, 'summary.json');
    let summary = null;
    try {
      if (fs.existsSync(summaryPath)) {
        summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return { dir, summary };
  });

  jsonResponse(res, { name: raceName, racerNames, settings, racerScripts, results });
}

function handleResultDetail(req, res, raceName, resultDir) {
  const raceDir = safePath(RACES_DIR, raceName);
  if (!raceDir) return errorResponse(res, 'Invalid race name', 400);
  const fullResultDir = safePath(raceDir, resultDir);
  if (!fullResultDir) return errorResponse(res, 'Invalid result dir', 400);

  const summaryPath = path.join(fullResultDir, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    return errorResponse(res, 'Result not found', 404);
  }

  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    jsonResponse(res, { dir: resultDir, summary });
  } catch (e) {
    errorResponse(res, 'Failed to read summary', 500);
  }
}

function handleResultFile(req, res, raceName, resultDir, filePath) {
  const raceDir = safePath(RACES_DIR, raceName);
  if (!raceDir) return errorResponse(res, 'Invalid path', 400);
  const fullResultDir = safePath(raceDir, resultDir);
  if (!fullResultDir) return errorResponse(res, 'Invalid path', 400);
  const fullPath = safePath(fullResultDir, filePath);
  if (!fullPath) return errorResponse(res, 'Invalid path', 400);

  fs.stat(fullPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const total = stat.size;
    const rangeHeader = req.headers['range'];

    const baseHeaders = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    };

    if (rangeHeader) {
      const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
      if (!m) { res.writeHead(416); res.end(); return; }
      let start, end;
      if (!m[1] && !m[2]) { res.writeHead(416); res.end(); return; }
      if (!m[1]) {
        start = Math.max(0, total - parseInt(m[2], 10));
        end = total - 1;
      } else {
        start = parseInt(m[1], 10);
        end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
      }
      if (start > end || start >= total) { res.writeHead(416); res.end(); return; }
      res.writeHead(206, { ...baseHeaders, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${total}` });
      fs.createReadStream(fullPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
      fs.createReadStream(fullPath).pipe(res);
    }
  });
}

const VALID_NETWORKS = new Set(['', 'none', 'slow-3g', 'fast-3g', '4g']);

async function handleRunRace(req, res, raceName) {
  const raceDir = safePath(RACES_DIR, raceName);
  if (!raceDir || !fs.existsSync(raceDir)) {
    return errorResponse(res, 'Race not found', 404);
  }

  // Check if race is already running
  for (const [, race] of activeRaces) {
    if (race.name === raceName && race.status === 'running') {
      return errorResponse(res, 'Race is already running', 409);
    }
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return errorResponse(res, 'Request body too large', 413);
  }

  const flags = [];
  if (body) {
    let opts;
    try {
      opts = JSON.parse(body);
    } catch {
      return errorResponse(res, 'Invalid JSON body', 400);
    }
    if (opts.headless !== false) flags.push('--headless');
    if (opts.parallel) flags.push('--parallel');
    const runs = parseInt(opts.runs, 10);
    if (runs > 0 && runs <= 20) flags.push(`--runs=${runs}`);
    if (opts.network && VALID_NETWORKS.has(opts.network)) flags.push(`--network=${opts.network}`);
    const cpu = parseInt(opts.cpu, 10);
    if (cpu > 1 && cpu <= 20) flags.push(`--cpu=${cpu}`);
    if (opts.noRecording) flags.push('--no-recording');
  } else {
    flags.push('--headless');
  }

  flags.push('--no-serve');

  // Create a screencast directory for live frame streaming
  const screencastDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-screencast-'));

  // Discover racer names for this race so we know what frame files to expect
  const { racerNames: raceRacerNames } = loadRaceInfo(safePath(RACES_DIR, raceName));

  const raceId = ++raceIdCounter;
  const raceState = {
    id: raceId,
    name: raceName,
    status: 'running',
    output: '',
    startTime: Date.now(),
    endTime: null,
    process: null,
    screencastDir,
    racerNames: raceRacerNames,
  };
  activeRaces.set(raceId, raceState);

  const raceProcess = spawn('node', [path.join(__dirname, 'race.js'), raceDir, ...flags], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RACE_SCREENCAST_DIR: screencastDir },
  });
  raceState.process = raceProcess;

  const appendOutput = (d) => {
    raceState.output += d.toString();
    if (raceState.output.length > MAX_OUTPUT_BUFFER) {
      raceState.output = raceState.output.slice(-MAX_OUTPUT_BUFFER);
    }
  };

  raceProcess.stdout.on('data', appendOutput);
  raceProcess.stderr.on('data', appendOutput);

  raceProcess.on('close', (code) => {
    raceState.status = code === 0 ? 'completed' : 'failed';
    raceState.endTime = Date.now();
    raceState.process = null;
    // Clean up screencast dir after a short delay (allow final frame reads)
    setTimeout(() => {
      try { fs.rmSync(screencastDir, { recursive: true, force: true }); } catch {}
      raceState.screencastDir = null;
    }, 5000);
    // Clean up race state after 10 minutes
    setTimeout(() => activeRaces.delete(raceId), 10 * 60 * 1000);
  });

  raceProcess.on('error', (err) => {
    raceState.status = 'failed';
    raceState.output += `\nProcess error: ${err.message}`;
    raceState.endTime = Date.now();
    raceState.process = null;
  });

  jsonResponse(res, { raceId, status: 'running', message: `Race "${raceName}" started` });
}

function handleRaceStatus(req, res, raceId) {
  const id = parseInt(raceId, 10);
  const race = activeRaces.get(id);
  if (!race) return errorResponse(res, 'Race not found', 404);
  jsonResponse(res, {
    id: race.id, name: race.name, status: race.status,
    startTime: race.startTime, endTime: race.endTime,
    output: race.output, racerNames: race.racerNames || [],
  });
}

function handleRaceFrame(req, res, raceId, racerName) {
  const id = parseInt(raceId, 10);
  const race = activeRaces.get(id);
  if (!race) { res.writeHead(404); res.end(); return; }
  if (!race.screencastDir) { res.writeHead(404); res.end(); return; }

  // Validate racer name against known racers
  if (!race.racerNames.includes(racerName)) { res.writeHead(404); res.end(); return; }

  const framePath = path.join(race.screencastDir, `${racerName}.jpg`);
  try {
    const data = fs.readFileSync(framePath);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    // Frame not yet available
    res.writeHead(204);
    res.end();
  }
}

function handleRaceCancel(req, res, raceId) {
  const id = parseInt(raceId, 10);
  const race = activeRaces.get(id);
  if (!race) return errorResponse(res, 'Race not found', 404);
  if (race.status !== 'running' || !race.process) {
    return errorResponse(res, 'Race is not running', 409);
  }
  const killed = race.process.kill('SIGTERM');
  if (!killed) {
    return errorResponse(res, 'Failed to cancel race', 500);
  }
  race.status = 'cancelling';
  jsonResponse(res, { id: race.id, status: 'cancelling' });
}

// --- Static file serving for webapp UI ---

function serveStaticFile(res, filePath) {
  const absPath = safePath(path.join(__dirname, 'webapp'), filePath);
  if (!absPath) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'text/html';
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size });
    fs.createReadStream(absPath).pipe(res);
  });
}

// --- Router ---

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // No CORS headers — same-origin only (local dev server)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  const apiMatch = pathname.match(/^\/api\/(.+)$/);
  if (apiMatch) {
    const apiPath = apiMatch[1];

    // GET /api/races
    if (apiPath === 'races' && req.method === 'GET') {
      return handleListRaces(req, res);
    }

    // GET /api/races/:name/results/:dir/files/*
    const fileMatch = apiPath.match(/^races\/([^/]+)\/results\/([^/]+)\/files\/(.+)$/);
    if (fileMatch && req.method === 'GET') {
      return handleResultFile(req, res, fileMatch[1], fileMatch[2], fileMatch[3]);
    }

    // GET /api/races/:name/results/:dir
    const resultMatch = apiPath.match(/^races\/([^/]+)\/results\/([^/]+)$/);
    if (resultMatch && req.method === 'GET') {
      return handleResultDetail(req, res, resultMatch[1], resultMatch[2]);
    }

    // POST /api/races/:name/run
    const runMatch = apiPath.match(/^races\/([^/]+)\/run$/);
    if (runMatch && req.method === 'POST') {
      return handleRunRace(req, res, runMatch[1]);
    }

    // GET /api/races/status/:id
    const statusMatch = apiPath.match(/^races\/status\/(\d+)$/);
    if (statusMatch && req.method === 'GET') {
      return handleRaceStatus(req, res, statusMatch[1]);
    }

    // GET /api/races/status/:id/frame/:racerName
    const frameMatch = apiPath.match(/^races\/status\/(\d+)\/frame\/([^/]+)$/);
    if (frameMatch && req.method === 'GET') {
      return handleRaceFrame(req, res, frameMatch[1], decodeURIComponent(frameMatch[2]));
    }

    // POST /api/races/status/:id/cancel
    const cancelMatch = apiPath.match(/^races\/status\/(\d+)\/cancel$/);
    if (cancelMatch && req.method === 'POST') {
      return handleRaceCancel(req, res, cancelMatch[1]);
    }

    // GET /api/races/:name
    const raceMatch = apiPath.match(/^races\/([^/]+)$/);
    if (raceMatch && req.method === 'GET') {
      return handleRaceDetail(req, res, raceMatch[1]);
    }

    return errorResponse(res, 'Not found', 404);
  }

  // Serve frontend
  if (pathname === '/' || pathname === '/index.html') {
    return serveStaticFile(res, 'index.html');
  }

  // Serve other static webapp files
  return serveStaticFile(res, pathname.slice(1));
}

// --- Start server ---

const args = process.argv.slice(2);
let port = 3000;
for (const arg of args) {
  const m = arg.match(/^--port=(\d+)$/);
  if (m) port = parseInt(m[1], 10);
}

const server = http.createServer(route);
server.listen(port, () => {
  console.log(`Race Viewer running at http://localhost:${port}/`);
  console.log(`Serving races from: ${RACES_DIR}`);
});
