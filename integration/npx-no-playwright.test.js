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
 * Requires: npm, npx and tar on PATH, and a filesystem that allows symlinks.
 * Those missing skip the suite; anything else going wrong fails it.
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
let missingPrerequisite = null;

/**
 * Name what this test needs and cannot find, or null when it can run.
 *
 * Only an absent prerequisite may skip the suite. A tool that is present but
 * fails — `npm pack` choking on the `files` allowlist, a tarball that will not
 * extract — is the packaging regression this suite exists to catch, so staging
 * lets those throw and fail the run instead.
 *
 * @param {string} dir - a writable directory to probe symlink support in
 * @returns {string|null} the skip reason, or null
 */
function findMissingPrerequisite(dir) {
  for (const tool of ['npm', 'npx', 'tar']) {
    const probe = spawnSync(tool, ['--version'], { encoding: 'utf-8', timeout: 30_000 });
    if (probe.error || probe.status !== 0) return `${tool} is not available; skipping npx packaging test`;
  }
  const link = path.join(dir, 'symlink-probe');
  try {
    fs.symlinkSync('.', link);
    fs.unlinkSync(link);
  } catch (e) {
    return `this filesystem does not allow symlinks (${e.code || e.message}); skipping npx packaging test`;
  }
  return null;
}

/** Pack the real tarball and unpack it the way npm installs a dependency. */
function stagePackedCli(dir) {
  const pack = spawnSync('npm', ['pack', '--pack-destination', dir], {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 120_000,
  });
  if (pack.status !== 0) throw new Error(`npm pack failed: ${pack.stderr || pack.error?.message}`);

  const tarball = fs.readdirSync(dir).find(f => f.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack produced no tarball');

  const proj = path.join(dir, 'proj');
  const modules = path.join(proj, 'node_modules');
  fs.mkdirSync(path.join(modules, '.bin'), { recursive: true });

  const untar = spawnSync('tar', ['-xzf', path.join(dir, tarball), '-C', modules], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr || untar.error?.message}`);

  // npm unpacks the tarball's `package/` directory under the package name.
  fs.renameSync(path.join(modules, 'package'), path.join(modules, CLI_NAME));
  fs.symlinkSync(path.join('..', CLI_NAME, 'race.js'), path.join(modules, '.bin', CLI_NAME));
  fs.chmodSync(path.join(modules, CLI_NAME, 'race.js'), 0o755);
  return proj;
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-npx-'));
  missingPrerequisite = findMissingPrerequisite(workDir);
  if (missingPrerequisite) return;
  projDir = stagePackedCli(workDir);
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
    if (missingPrerequisite) skip(missingPrerequisite);

    expect(fs.existsSync(path.join(projDir, 'node_modules', CLI_NAME, 'node_modules'))).toBe(false);

    const proc = runNpx('--version');
    expect(proc.stderr || '').not.toContain('Cannot find module');
    expect(proc.status).toBe(0);
    const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
    expect(proc.stdout).toContain(version);
  });

  it('prints the help screen spelled for npx', ({ skip }) => {
    if (missingPrerequisite) skip(missingPrerequisite);

    const proc = runNpx('--help');
    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain(`npx ${CLI_NAME}`);
    expect(proc.stdout).not.toContain('node race.js');
  });

  it('copies a demo, then refuses to race with a message an npx user can act on', ({ skip }) => {
    if (missingPrerequisite) skip(missingPrerequisite);

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
