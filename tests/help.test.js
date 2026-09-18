import { describe, it, expect } from 'vitest';
import { buildHelp, resolveInvocation, PKG_NAME } from '../cli/help.js';
import { KNOWN_FLAGS } from '../cli/config.js';

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('resolveInvocation', () => {
  it('uses the bare bin name for a global install', () => {
    expect(resolveInvocation(`/usr/local/bin/${PKG_NAME}`)).toEqual({ cmd: PKG_NAME, installed: true });
  });

  it('uses npx for a one-off npx run (the shim does not survive it)', () => {
    const argv1 = `/home/me/.npm/_npx/9f3/node_modules/.bin/${PKG_NAME}`;
    expect(resolveInvocation(argv1)).toEqual({ cmd: `npx ${PKG_NAME}`, installed: true });
  });

  it('uses npx for a project dependency', () => {
    const argv1 = `/work/app/node_modules/${PKG_NAME}/race.js`;
    expect(resolveInvocation(argv1)).toEqual({ cmd: `npx ${PKG_NAME}`, installed: true });
  });

  it('handles the Windows bin shim and separators', () => {
    expect(resolveInvocation(`C:\\Users\\me\\AppData\\npm\\${PKG_NAME}.cmd`))
      .toEqual({ cmd: PKG_NAME, installed: true });
  });

  it('falls back to node race.js for a git checkout', () => {
    expect(resolveInvocation('/home/me/race-for-the-prize/race.js'))
      .toEqual({ cmd: 'node race.js', installed: false });
    expect(resolveInvocation('')).toEqual({ cmd: 'node race.js', installed: false });
    expect(resolveInvocation(null)).toEqual({ cmd: 'node race.js', installed: false });
  });
});

describe('buildHelp', () => {
  const installedHelp = () => strip(buildHelp(resolveInvocation(`/usr/local/bin/${PKG_NAME}`)));
  const checkoutHelp = () => strip(buildHelp(resolveInvocation('/repo/race.js')));

  it('spells every example with the command the reader actually has', () => {
    const help = installedHelp();
    expect(help).not.toContain('node race.js');
    expect(help).toContain(`${PKG_NAME} <url> <url> [url...]`);
    expect(help).toContain(`${PKG_NAME} --init my-race`);
  });

  it('keeps node race.js for a checkout', () => {
    expect(checkoutHelp()).toContain('node race.js --init my-race');
  });

  it('documents how to install the published package', () => {
    const help = installedHelp();
    expect(help).toContain(`npx ${PKG_NAME}@latest`);
    expect(help).toContain(`npm install -g ${PKG_NAME}`);
    expect(help).toContain(`npm install -D ${PKG_NAME}`);
    expect(help).toContain('npx playwright install chromium');
  });

  it('points npm users at --init, not at the races/ shipped inside the install', () => {
    expect(installedHelp()).toContain(`Start here:  ${PKG_NAME} --init my-race`);
    expect(checkoutHelp()).toContain('Start here:  node race.js ./races/lauda-vs-hunt');
  });

  it('lists the built-in skins it was given', () => {
    const help = strip(buildHelp({ cmd: PKG_NAME, installed: true, skins: ['light', 'neon'] }));
    expect(help).toContain('light, neon, or a path to a .css file');
  });

  it('documents every flag the CLI accepts', () => {
    const help = installedHelp();
    for (const flag of KNOWN_FLAGS) {
      expect(help, `--${flag} is missing from the help`).toContain(`--${flag}`);
    }
  });

  it('lines the flag descriptions up in one column', () => {
    const flagLines = installedHelp()
      .split('\n')
      .filter(l => /^ {2}--/.test(l) && l.trim().includes('  '));
    expect(flagLines.length).toBeGreaterThan(20);
    for (const line of flagLines) {
      expect(line.search(/ \S/g) >= 0).toBe(true);
      const description = line.replace(/^ {2}\S+ +/, '');
      expect(line.length - description.length, `misaligned: ${line}`).toBe(25);
    }
  });
});
