/**
 * npx-no-playwright.test.js — what a first-time `npx race-for-the-prize` user
 * sees when Playwright is not there.
 *
 * `findMissingBrowser` is unit-tested with injected dependencies, but the path
 * this covers is the packaging around it: the `files` allowlist in
 * package.json, the `bin` wiring, and the fact that race.js reaches its own
 * error message instead of dying on a top-level `import 'playwright'`.
 *
 * So it packs the real tarball, unpacks it the way npm would install it, links
 * the bin, and calls it through `npx --no-install` — no registry, no network,
 * and no node_modules anywhere above the temp directory to resolve Playwright
 * from by accident.
 *
 * Requires: npm and tar on PATH, and a filesystem that allows symlinks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const CLI_NAME = 'race-for-the-prize';

let workDir = null;
let projDir = null;
let setupError = null;

beforeAll(() => {
  try {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-npx-'));
    const pack = spawnSync('npm', ['pack', '--pack-destination', workDir], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr || pack.error?.message}`);

    const tarball = fs.readdirSync(workDir).find(f => f.endsWith('.tgz'));
    if (!tarball) throw new Error('npm pack produced no tarball');

    projDir = path.join(workDir, 'proj');
    const modules = path.join(projDir, 'node_modules');
    fs.mkdirSync(path.join(modules, '.bin'), { recursive: true });

    const untar = spawnSync('tar', ['-xzf', path.join(workDir, tarball), '-C', modules], {
      encoding: 'utf-8',
      timeout: 60_000,
    });
    if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr || untar.error?.message}`);

    // npm unpacks the tarball's `package/` directory under the package name.
    fs.renameSync(path.join(modules, 'package'), path.join(modules, CLI_NAME));
    fs.symlinkSync(path.join('..', CLI_NAME, 'race.js'), path.join(modules, '.bin', CLI_NAME));
    fs.chmodSync(path.join(modules, CLI_NAME, 'race.js'), 0o755);
  } catch (e) {
    setupError = e.message;
  }
});

afterAll(() => {
  if (workDir && fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
});

/** Run the staged CLI the way a user would. `--no-install` keeps npx offline. */
function runNpx(...args) {
  return spawnSync('npx', ['--no-install', CLI_NAME, ...args], {
    cwd: projDir,
    encoding: 'utf-8',
    timeout: 90_000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

describe('npx with no Playwright installed', () => {
  it('answers --version from the packed tarball', ({ skip }) => {
    if (setupError) skip(`could not stage the packed CLI (${setupError})`);

    expect(fs.existsSync(path.join(projDir, 'node_modules', CLI_NAME, 'node_modules'))).toBe(false);

    const proc = runNpx('--version');
    expect(proc.stderr || '').not.toContain('Cannot find module');
    expect(proc.status).toBe(0);
    const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    expect(proc.stdout).toContain(version);
  });

  it('prints the help screen spelled for npx', ({ skip }) => {
    if (setupError) skip(`could not stage the packed CLI (${setupError})`);

    const proc = runNpx('--help');
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain(`npx ${CLI_NAME}`);
    expect(proc.stdout).not.toContain('node race.js');
  });

  it('copies a demo, then refuses to race with a message an npx user can act on', ({ skip }) => {
    if (setupError) skip(`could not stage the packed CLI (${setupError})`);

    const proc = runNpx('demo:lauda-vs-hunt', '--yes', '--headless');

    // The demo's spec files ship in the tarball, so the copy must succeed even
    // though the race behind it cannot start.
    expect(fs.existsSync(path.join(projDir, 'races', 'lauda-vs-hunt', 'lauda.spec.js'))).toBe(true);

    expect(proc.status).toBe(1);
    const output = `${proc.stdout}${proc.stderr}`;
    expect(output).toContain('Playwright is not installed');
    expect(output).toContain('reinstall the package');
    // "Run npm install" is advice for a checkout, not for someone who typed npx.
    expect(output).not.toContain('npm install');
  });
});
