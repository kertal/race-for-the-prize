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
import { convertVideos } from '../cli/results.js';

/**
 * Resolve the absolute path of a CLI tool to avoid relying on PATH.
 * Returns null when the tool is not installed.
 */
function resolveToolPath(name) {
  try {
    return execFileSync('/usr/bin/which', [name], { stdio: 'pipe', timeout: 5_000 })
      .toString().trim();
  } catch {
    return null;
  }
}

const FFMPEG  = resolveToolPath('ffmpeg');
const FFPROBE = resolveToolPath('ffprobe');
const HAS_TOOLS = Boolean(FFMPEG && FFPROBE);

/**
 * Probe a video file and return its width, height, and codec name.
 */
function getVideoInfo(videoPath) {
  const out = execFileSync(FFPROBE, [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', videoPath,
  ], { timeout: 10_000 });
  const info = JSON.parse(out.toString());
  const v = info.streams.find(s => s.codec_type === 'video');
  return { width: v.width, height: v.height, codec: v.codec_name };
}

/**
 * Generate a solid-colour WebM test fixture.
 * Uses VP9 + yuv444p so odd dimensions are encoded without error.
 */
function createTestWebm(outputPath, width, height, durationSecs = 1) {
  execFileSync(FFMPEG, [
    '-f', 'lavfi', '-i', `color=red:size=${width}x${height}:rate=25`,
    '-t', String(durationSecs),
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuv444p',
    '-y', outputPath,
  ], { stdio: 'pipe', timeout: 30_000 });
}

/**
 * Convert a WebM to MOV via convertVideos() and verify even-dimension h264 output.
 */
function convertAndVerifyMov(webmPath, width, height) {
  createTestWebm(webmPath, width, height);
  const results = [{ videoPath: webmPath }];
  convertVideos(results, 'mov');
  const mov = webmPath.replace('.webm', '.mov');
  expect(fs.existsSync(mov)).toBe(true);
  const info = getVideoInfo(mov);
  expect(info.codec).toBe('h264');
  expect(info.width % 2).toBe(0);
  expect(info.height % 2).toBe(0);
  return { results, info };
}

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
    const { results } = convertAndVerifyMov(webm, 1280, 720);
    expect(results[0].videoPath).toBe(webm.replace('.webm', '.mov'));
  });

  it.skipIf(!HAS_TOOLS)('converts odd-height WebM to MOV without failing (custom --height)', () => {
    // height=751 triggers odd cellH in canvas export; libx264 rejects odd dimensions
    // without the scale=trunc(iw/2)*2:trunc(ih/2)*2 filter
    convertAndVerifyMov(path.join(tmpDir, 'odd-height.webm'), 1280, 751);
  });

  it.skipIf(!HAS_TOOLS)('converts odd-width WebM to MOV without failing', () => {
    convertAndVerifyMov(path.join(tmpDir, 'odd-width.webm'), 1281, 720);
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
