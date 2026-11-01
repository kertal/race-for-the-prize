/**
 * Integration test: split mode (per-racer setup scripts) with recording
 * disabled must produce the same measurement-only output as normal mode —
 * no video player and no ffmpeg.wasm bundle pointing at videos that were
 * never recorded.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { hasChromiumInstalled, parseResultsDir } from './test-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let raceDir = null;

describe('split mode without recording', () => {
  it('writes measurements only, like normal mode', ({ skip }) => {
    if (!hasChromiumInstalled(projectRoot)) {
      skip('Playwright Chromium binary not installed; skipping split-mode integration test');
    }

    // A per-racer setup script forces split mode (every run of one racer
    // before the next). Two racers keep the race short.
    raceDir = fs.mkdtempSync(path.join(projectRoot, 'races', 'tmp-split-no-recording-'));
    const spec = "await page.goto('about:blank');\nawait page.raceStart('Load');\npage.raceEnd('Load');\n";
    fs.writeFileSync(path.join(raceDir, 'alpha.spec.js'), spec);
    fs.writeFileSync(path.join(raceDir, 'bravo.spec.js'), spec);
    fs.writeFileSync(path.join(raceDir, 'alpha.setup.sh'), '#!/bin/sh\necho setup\n');

    const proc = spawnSync(
      'node',
      ['race.js', path.relative(projectRoot, raceDir), '--headless', '--recording=false', '--serve=false'],
      { cwd: projectRoot, timeout: 90_000, encoding: 'utf-8', env: { ...process.env, FORCE_COLOR: '0' } }
    );

    expect(proc.status).toBe(0);

    const resultsDir = parseResultsDir(projectRoot, proc.stderr);
    expect(resultsDir).toBeTruthy();

    const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));
    expect(summary.racers).toEqual(['alpha', 'bravo']);
    expect(summary.comparisons.map(c => c.name)).toEqual(['Load']);
    expect(fs.existsSync(path.join(resultsDir, 'alpha', 'measurements.json'))).toBe(true);
    expect(fs.existsSync(path.join(resultsDir, 'README.md'))).toBe(true);

    // Nothing that only makes sense with a recording.
    expect(fs.existsSync(path.join(resultsDir, 'index.html'))).toBe(false);
    expect(fs.existsSync(path.join(resultsDir, 'ffmpeg'))).toBe(false);
  });
});

afterEach(() => {
  if (raceDir && fs.existsSync(raceDir)) {
    fs.rmSync(raceDir, { recursive: true, force: true });
    raceDir = null;
  }
});
