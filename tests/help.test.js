import { describe, it, expect } from 'vitest';
import { buildHelp, resolveInvocation, CLI_NAME } from '../cli/help.js';
import { KNOWN_FLAGS } from '../cli/config.js';

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('resolveInvocation', () => {
  it('uses the bare bin name for a global install', () => {
    expect(resolveInvocation(`/usr/local/bin/${CLI_NAME}`)).toBe(CLI_NAME);
  });

  it('uses npx for a one-off npx run (the shim does not survive it)', () => {
    expect(resolveInvocation(`/home/me/.npm/_npx/9f3/node_modules/.bin/${CLI_NAME}`)).toBe(`npx ${CLI_NAME}`);
  });

  it('uses npx for a project dependency', () => {
    expect(resolveInvocation(`/work/app/node_modules/${CLI_NAME}/race.js`)).toBe(`npx ${CLI_NAME}`);
  });

  it('uses npx for a project-local bin shim, whose name matches the global one', () => {
    expect(resolveInvocation(`/work/app/node_modules/.bin/${CLI_NAME}`)).toBe(`npx ${CLI_NAME}`);
  });

  it('handles the Windows bin shim and separators', () => {
    expect(resolveInvocation(`C:\\Users\\me\\AppData\\npm\\${CLI_NAME}.cmd`)).toBe(CLI_NAME);
  });

  it('falls back to node race.js for a git checkout', () => {
    expect(resolveInvocation('/home/me/race-for-the-prize/race.js')).toBe('node race.js');
    expect(resolveInvocation('')).toBe('node race.js');
    expect(resolveInvocation(null)).toBe('node race.js');
  });
});

describe('buildHelp', () => {
  const installedHelp = () => strip(buildHelp(CLI_NAME));
  const checkoutHelp = () => strip(buildHelp('node race.js'));

  it('spells every example with the command the reader actually has', () => {
    const help = installedHelp();
    expect(help).not.toContain('node race.js');
    expect(help).toContain(`${CLI_NAME} <url> <url> [url...]`);
    expect(help).toContain(`${CLI_NAME} --init my-race`);
  });

  it('keeps node race.js for a checkout', () => {
    expect(checkoutHelp()).toContain('node race.js --init my-race');
  });

  it('documents how to install the published package', () => {
    const help = installedHelp();
    expect(help).toContain(`npx ${CLI_NAME}@latest`);
    expect(help).toContain(`npm install -g ${CLI_NAME}`);
    expect(help).toContain(`npm install -D ${CLI_NAME}`);
    expect(help).toContain('npx playwright install chromium');
  });

  it('sends every reader to a demo race, which needs no races/ of their own', () => {
    expect(installedHelp()).toContain(`Try a demo:  ${CLI_NAME} demo:lauda-vs-hunt`);
    expect(checkoutHelp()).toContain('Try a demo:  node race.js demo:lauda-vs-hunt');
    expect(installedHelp()).toContain(`${CLI_NAME} demo — to list them all`);
  });

  it('lists the built-in skins it was given', () => {
    const help = strip(buildHelp(CLI_NAME, ['light', 'neon']));
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
