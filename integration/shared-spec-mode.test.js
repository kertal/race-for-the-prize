import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let resultsDir = null;

function hasChromiumInstalled() {
  const check = spawnSync(
    'node',
    [
      '-e',
      "const { chromium } = require('playwright'); const fs = require('fs'); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);",
    ],
    { cwd: projectRoot, timeout: 10_000 }
  );
  return check.status === 0;
}

function parseResultsDir(stderrText) {
  const ansiRe = new RegExp('\\u001B\\[[0-9;]*m', 'g');
  const stripped = stderrText.replace(ansiRe, '');
  const match = stripped.match(/📂\s+(.+)/);
  return match ? path.resolve(projectRoot, match[1].trim()) : null;
}

describe('shared-spec mode integration', () => {
  it('runs trim-test in shared mode and produces ordered measurements', ({ skip }) => {
    if (!hasChromiumInstalled()) {
      skip('Playwright Chromium binary not installed; skipping shared-spec integration test');
    }

    const proc = spawnSync(
      'node',
      ['race.js', './races/trim-test', '--headless', '--no-recording', '--no-serve', '--runs=1'],
      {
        cwd: projectRoot,
        timeout: 90_000,
        encoding: 'utf-8',
        env: { ...process.env, FORCE_COLOR: '0' },
      }
    );

    expect(proc.status).toBe(0);

    resultsDir = parseResultsDir(proc.stderr);
    expect(resultsDir).toBeTruthy();
    expect(fs.existsSync(resultsDir)).toBe(true);

    const summary = JSON.parse(fs.readFileSync(path.join(resultsDir, 'summary.json'), 'utf-8'));
    expect(summary.overallWinner).toBe('alpha');
    expect(summary.comparisons).toHaveLength(3);
    expect(summary.comparisons[0].name).toBe('Render');
    expect(summary.comparisons[0].rankings).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    expect(summary.comparisons[1].name).toBe('Reload');
    expect(summary.comparisons[1].rankings).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    expect(summary.comparisons[2].name).toBe('Race');
  });
});

afterEach(() => {
  if (resultsDir && fs.existsSync(resultsDir)) {
    fs.rmSync(resultsDir, { recursive: true, force: true });
    resultsDir = null;
  }
});
