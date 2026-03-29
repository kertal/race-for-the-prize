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

describe('webapp API', () => {
  let server;
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

  // Cleanup
  it('stops the server', () => {
    if (server) server.kill();
  });
});
