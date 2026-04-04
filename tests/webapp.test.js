import { describe, it, expect } from 'vitest';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function startServer(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [path.join(ROOT, 'webapp.js'), `--port=${port}`], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => { proc.kill(); reject(new Error('Server start timeout')); }, 5000);
    proc.stdout.on('data', () => {
      clearTimeout(timeout);
      resolve(proc);
    });
    proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body || '');
  });
}

function httpOptions(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'OPTIONS' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('webapp API', () => {
  let server;
  let startedRaceId;
  const PORT = 13579;
  const BASE = `http://localhost:${PORT}`;

  // Start server once for all tests
  it('starts the server', async () => {
    server = await startServer(PORT);
  }, 10000);

  it('GET /api/races returns race list', async () => {
    const res = await httpGet(`${BASE}/api/races`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.races).toBeDefined();
    expect(Array.isArray(data.races)).toBe(true);
    expect(data.races.length).toBeGreaterThan(0);
    const race = data.races.find(r => r.name === 'lauda-vs-hunt');
    expect(race).toBeDefined();
    expect(race.racerNames).toContain('hunt');
    expect(race.racerNames).toContain('lauda');
  });

  it('GET /api/races/:name returns race detail', async () => {
    const res = await httpGet(`${BASE}/api/races/lauda-vs-hunt`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.name).toBe('lauda-vs-hunt');
    expect(data.racerNames).toContain('hunt');
    expect(data.racerScripts).toBeDefined();
    expect(data.racerScripts.lauda).toContain('Wikipedia');
  });

  it('GET /api/races/nonexistent returns 404', async () => {
    const res = await httpGet(`${BASE}/api/races/does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('rejects path traversal in race name', async () => {
    const res = await httpGet(`${BASE}/api/races/..%2F..%2Fetc`);
    expect(res.status).toBe(404);
  });

  it('rejects path traversal in result file path', async () => {
    const res = await httpGet(`${BASE}/api/races/lauda-vs-hunt/results/..%2F..%2Fetc/files/passwd`);
    expect([400, 404]).toContain(res.status);
  });

  it('GET / serves the HTML frontend', async () => {
    const res = await httpGet(`${BASE}/`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<race-app>');
  });

  it('POST /api/races/:name/run with invalid JSON returns 400', async () => {
    const res = await httpPost(`${BASE}/api/races/lauda-vs-hunt/run`, 'not json');
    expect(res.status).toBe(400);
    const data = JSON.parse(res.body);
    expect(data.error).toBe('Invalid JSON body');
  });

  it('GET /api/races/status/999 returns 404 for unknown race', async () => {
    const res = await httpGet(`${BASE}/api/races/status/999`);
    expect(res.status).toBe(404);
  });

  it('GET /api/nonexistent returns 404', async () => {
    const res = await httpGet(`${BASE}/api/nonexistent`);
    expect(res.status).toBe(404);
  });

  it('serves 404 for directory traversal in static files', async () => {
    const res = await httpGet(`${BASE}/..%2Fpackage.json`);
    expect(res.status).toBe(404);
  });

  it('serves 404 when requesting a directory as static file', async () => {
    // The webapp directory itself should not be served as a file
    const res = await httpGet(`${BASE}/`);
    // Root serves index.html
    expect(res.status).toBe(200);
    // But a non-existent sub-path returns 404
    const res2 = await httpGet(`${BASE}/nonexistent-dir/`);
    expect(res2.status).toBe(404);
  });

  it('GET /api/races/:name/results/nonexistent returns 404', async () => {
    const res = await httpGet(`${BASE}/api/races/lauda-vs-hunt/results/results-nonexistent`);
    expect(res.status).toBe(404);
  });

  it('rejects path traversal in result dir', async () => {
    const res = await httpGet(`${BASE}/api/races/lauda-vs-hunt/results/..%2F..%2Fetc`);
    expect([400, 404]).toContain(res.status);
  });

  it('POST /api/races/:name/run starts a race and returns raceId', async () => {
    const res = await httpPost(`${BASE}/api/races/lauda-vs-hunt/run`, JSON.stringify({ headless: true }));
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.raceId).toBeDefined();
    expect(data.status).toBe('running');
    // Save raceId for subsequent tests
    startedRaceId = data.raceId;
  });

  it('POST /api/races/:name/run returns 409 when race is already running', async () => {
    // The race started above should still be running
    const res = await httpPost(`${BASE}/api/races/lauda-vs-hunt/run`, JSON.stringify({ headless: true }));
    expect(res.status).toBe(409);
    const data = JSON.parse(res.body);
    expect(data.error).toContain('already running');
  });

  it('GET /api/races/status/:id returns running status', async () => {
    const res = await httpGet(`${BASE}/api/races/status/${startedRaceId}`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.id).toBe(startedRaceId);
    expect(data.name).toBe('lauda-vs-hunt');
    expect(['running', 'completed', 'failed']).toContain(data.status);
    expect(data.output).toBeDefined();
  });

  it('POST /api/races/status/:id/cancel cancels a running race', async () => {
    const res = await httpPost(`${BASE}/api/races/status/${startedRaceId}/cancel`);
    // Could be 200 (cancelled) or 409 (already finished)
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      expect(data.status).toBe('cancelling');
    } else {
      expect(res.status).toBe(409);
    }
  });

  it('POST /api/races/status/999/cancel returns 404 for unknown race', async () => {
    const res = await httpPost(`${BASE}/api/races/status/999/cancel`);
    expect(res.status).toBe(404);
  });

  it('POST /api/races/nonexistent/run returns 404', async () => {
    const res = await httpPost(`${BASE}/api/races/does-not-exist/run`, JSON.stringify({}));
    expect(res.status).toBe(404);
  });

  it('OPTIONS returns 204 (no CORS, same-origin)', async () => {
    const res = await httpOptions(`${BASE}/api/races`);
    expect(res.status).toBe(204);
  });

  // Cleanup
  it('stops the server', () => {
    if (server) server.kill();
  });
});
