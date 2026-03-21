/**
 * Integration tests for video format conversion (MOV/GIF).
 *
 * Verifies that convertVideos() produces valid output for both even and odd
 * input dimensions. libx264 (MOV) requires even width/height; these tests
 * catch regressions where the scale filter is missing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertVideos } from '../cli/results.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hasTool(name) {
  try { execFileSync(name, ['-version'], { stdio: 'pipe', timeout: 5_000 }); return true; }
  catch { return false; }
}

function getVideoInfo(videoPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', videoPath,
  ], { timeout: 10_000 });
  const info = JSON.parse(out.toString());
  const v = info.streams.find(s => s.codec_type === 'video');
  return { width: v.width, height: v.height, codec: v.codec_name };
}

function createTestWebm(outputPath, width, height, durationSecs = 1) {
  execFileSync('ffmpeg', [
    '-f', 'lavfi', '-i', `color=red:size=${width}x${height}:rate=25`,
    '-t', String(durationSecs), '-y', outputPath,
  ], { stdio: 'pipe', timeout: 30_000 });
}

const HAS_TOOLS = hasTool('ffmpeg') && hasTool('ffprobe');

describe('export format conversion', () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-export-test-'));
  });

  afterAll(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.skipIf(!HAS_TOOLS)('converts even-dimension WebM to MOV (default 720p)', () => {
    const webm = path.join(tmpDir, 'even.webm');
    createTestWebm(webm, 1280, 720);
    const results = [{ videoPath: webm }];
    convertVideos(results, 'mov');
    const mov = webm.replace('.webm', '.mov');
    expect(fs.existsSync(mov)).toBe(true);
    const info = getVideoInfo(mov);
    expect(info.codec).toBe('h264');
    expect(info.width % 2).toBe(0);
    expect(info.height % 2).toBe(0);
    expect(results[0].videoPath).toBe(mov);
  });

  it.skipIf(!HAS_TOOLS)('converts odd-height WebM to MOV without failing (custom --height)', () => {
    // height=751 triggers odd cellH in canvas export; libx264 rejects odd dimensions
    // without the scale=trunc(iw/2)*2:trunc(ih/2)*2 filter
    const webm = path.join(tmpDir, 'odd-height.webm');
    createTestWebm(webm, 1280, 751);
    const results = [{ videoPath: webm }];
    convertVideos(results, 'mov');
    const mov = webm.replace('.webm', '.mov');
    expect(fs.existsSync(mov)).toBe(true);
    const info = getVideoInfo(mov);
    expect(info.codec).toBe('h264');
    expect(info.width % 2).toBe(0);
    expect(info.height % 2).toBe(0);
  });

  it.skipIf(!HAS_TOOLS)('converts odd-width WebM to MOV without failing', () => {
    const webm = path.join(tmpDir, 'odd-width.webm');
    createTestWebm(webm, 1281, 720);
    const results = [{ videoPath: webm }];
    convertVideos(results, 'mov');
    const mov = webm.replace('.webm', '.mov');
    expect(fs.existsSync(mov)).toBe(true);
    const info = getVideoInfo(mov);
    expect(info.codec).toBe('h264');
    expect(info.width % 2).toBe(0);
    expect(info.height % 2).toBe(0);
  });

  it.skipIf(!HAS_TOOLS)('converts WebM to GIF', () => {
    const webm = path.join(tmpDir, 'gif-test.webm');
    createTestWebm(webm, 1280, 720);
    const results = [{ videoPath: webm }];
    convertVideos(results, 'gif');
    const gif = webm.replace('.webm', '.gif');
    expect(fs.existsSync(gif)).toBe(true);
    expect(results[0].videoPath).toBe(gif);
  });

  it.skipIf(!HAS_TOOLS)('converts odd-height WebM to GIF (scale filter handles odd dimensions)', () => {
    const webm = path.join(tmpDir, 'odd-gif.webm');
    createTestWebm(webm, 1280, 751);
    const results = [{ videoPath: webm }];
    convertVideos(results, 'gif');
    const gif = webm.replace('.webm', '.gif');
    expect(fs.existsSync(gif)).toBe(true);
  });

  it.skipIf(!HAS_TOOLS)('converts fullVideoPath as well as videoPath', () => {
    const webm1 = path.join(tmpDir, 'full1.webm');
    const webm2 = path.join(tmpDir, 'full2.webm');
    createTestWebm(webm1, 1280, 720);
    createTestWebm(webm2, 1280, 751);
    const results = [{ videoPath: webm1, fullVideoPath: webm2 }];
    convertVideos(results, 'mov');
    expect(fs.existsSync(webm1.replace('.webm', '.mov'))).toBe(true);
    expect(fs.existsSync(webm2.replace('.webm', '.mov'))).toBe(true);
  });
});
