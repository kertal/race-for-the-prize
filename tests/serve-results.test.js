import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import net from 'net';
import { createStaticHandler } from '../race.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-test-'));
  fs.writeFileSync(path.join(tmpDir, 'index.html'), '<h1>Test</h1>');
  fs.writeFileSync(path.join(tmpDir, 'data.json'), '{}');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function rawRequest(port, raw) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1', () => socket.write(raw));
    let data = '';
    socket.on('data', d => data += d);
    socket.on('end', () => {
      const status = parseInt(data.split('\r\n')[0].split(' ')[1], 10);
      resolve({ status });
    });
  });
}

function fetch(server, urlPath, reqHeaders = {}) {
  return new Promise((resolve) => {
    const { port } = server.address();
    const opts = { hostname: '127.0.0.1', port, path: urlPath, headers: reqHeaders };
    http.get(opts, (res) => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf.toString(), bodyBuffer: buf });
      });
    });
  });
}

describe('serveResults path traversal protection', () => {
  let server;

  beforeEach(() => {
    server = http.createServer(createStaticHandler(tmpDir));
    return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(() => {
    return new Promise(resolve => server.close(resolve));
  });

  it('serves index.html for root path', async () => {
    const res = await fetch(server, '/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('<h1>Test</h1>');
  });

  it('serves files by name', async () => {
    const res = await fetch(server, '/data.json');
    expect(res.status).toBe(200);
    expect(res.body).toBe('{}');
  });

  it('blocks .. path traversal via raw request', async () => {
    // Node's http.get normalizes .. before sending, so use raw TCP to test
    const { port } = server.address();
    const res = await rawRequest(port, 'GET /../etc/passwd HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    expect(res.status).toBe(403);
  });

  it('blocks encoded %2e%2e path traversal via raw request', async () => {
    const { port } = server.address();
    const res = await rawRequest(port, 'GET /%2e%2e/etc/passwd HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    expect(res.status).toBe(403);
  });

  it('blocks double-encoded traversal', async () => {
    const res = await fetch(server, '/%252e%252e/etc/passwd');
    // After single decode this becomes %2e%2e which is literal — should 404 not escape
    expect([403, 404]).toContain(res.status);
  });

  it('returns 400 for malformed percent encoding', async () => {
    const res = await fetch(server, '/%ZZ');
    expect(res.status).toBe(400);
  });

  it('returns 404 for nonexistent file', async () => {
    const res = await fetch(server, '/nonexistent.txt');
    expect(res.status).toBe(404);
  });
});

describe('serveResults range request support', () => {
  let server;
  let fileContent;

  beforeEach(() => {
    // Write a binary file with known content for range testing
    fileContent = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'); // 26 bytes
    fs.writeFileSync(path.join(tmpDir, 'data.bin'), fileContent);
    server = http.createServer(createStaticHandler(tmpDir));
    return new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(() => new Promise(resolve => server.close(resolve)));

  it('includes Accept-Ranges: bytes on normal 200 response', async () => {
    const res = await fetch(server, '/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
  });

  it('includes Content-Length on normal 200 response', async () => {
    const res = await fetch(server, '/data.bin');
    expect(res.status).toBe(200);
    expect(parseInt(res.headers['content-length'], 10)).toBe(fileContent.length);
  });

  it('responds 206 with correct slice for a range request', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=0-4' });
    expect(res.status).toBe(206);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-range']).toBe(`bytes 0-4/${fileContent.length}`);
    expect(parseInt(res.headers['content-length'], 10)).toBe(5);
    expect(res.bodyBuffer).toEqual(fileContent.slice(0, 5));
  });

  it('responds 206 for a mid-file range', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=10-19' });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 10-19/${fileContent.length}`);
    expect(res.bodyBuffer).toEqual(fileContent.slice(10, 20));
  });

  it('responds 206 for open-ended range (bytes=N-)', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=20-' });
    expect(res.status).toBe(206);
    expect(res.bodyBuffer).toEqual(fileContent.slice(20));
  });

  it('clamps end to file size for out-of-bounds range end', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=20-9999' });
    expect(res.status).toBe(206);
    expect(res.bodyBuffer).toEqual(fileContent.slice(20));
  });

  it('responds 416 for start beyond file size', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=9999-' });
    expect(res.status).toBe(416);
  });

  it('responds 416 for inverted range (start > end)', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=10-5' });
    expect(res.status).toBe(416);
  });

  it('responds 206 for suffix-range (bytes=-N)', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=-5' });
    expect(res.status).toBe(206);
    expect(res.bodyBuffer).toEqual(fileContent.slice(-5)); // last 5 bytes: VWXYZ
  });

  it('clamps suffix-range to full file when N exceeds file size', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=-9999' });
    expect(res.status).toBe(206);
    expect(res.bodyBuffer).toEqual(fileContent); // entire file
  });

  it('responds 416 for bare bytes=- with no numbers', async () => {
    const res = await fetch(server, '/data.bin', { range: 'bytes=-' });
    expect(res.status).toBe(416);
  });

  it('returns 404 for directories (stat.isFile() guard)', async () => {
    // The tmpDir itself is a directory — requesting it must not stream EISDIR.
    const res = await fetch(server, '/');
    // '/' is rewritten to index.html which is a file, so use a subdir instead.
    fs.mkdirSync(path.join(tmpDir, 'subdir'), { recursive: true });
    const dirRes = await fetch(server, '/subdir');
    expect(dirRes.status).toBe(404);
  });
});
