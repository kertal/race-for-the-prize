import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  PROTOCOL_VERSION,
  isSafeRacerId,
  confinePath,
  formatRaceMessage,
  createRaceMessageRegex,
  formatContextClosed,
} = require('../runner-protocol.cjs');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runRunner(config) {
  return spawnSync('node', ['runner.cjs', JSON.stringify(config)], {
    cwd: projectRoot,
    timeout: 30_000,
    encoding: 'utf-8',
  });
}

describe('isSafeRacerId', () => {
  it('accepts plain names', () => {
    for (const id of ['lauda', 'racer-a', 'my_racer', 'a.b', 'A1']) {
      expect(isSafeRacerId(id), id).toBe(true);
    }
  });

  it('rejects path separators, traversal, and non-strings', () => {
    for (const id of ['a/b', 'a\\b', '..', '.', '', '../x', 'a\0b', null, undefined, 42, {}]) {
      expect(isSafeRacerId(id), String(id)).toBe(false);
    }
  });
});

describe('confinePath', () => {
  const base = path.join(path.sep, 'tmp', 'recordings');

  it('resolves segments inside the base directory', () => {
    expect(confinePath(base, 'lauda', 'lauda.trace.json'))
      .toBe(path.join(base, 'lauda', 'lauda.trace.json'));
    expect(confinePath(base)).toBe(base);
  });

  it('throws when segments escape the base directory', () => {
    expect(() => confinePath(base, '..', 'escape')).toThrow(/escapes base directory/);
    expect(() => confinePath(base, 'a', '..', '..', 'b')).toThrow(/escapes base directory/);
    expect(() => confinePath(base, path.join(path.sep, 'etc', 'passwd'))).toThrow(/escapes base directory/);
  });

  it('does not treat sibling directories with a shared prefix as inside', () => {
    expect(() => confinePath(base, `..${path.sep}recordings-evil`)).toThrow(/escapes base directory/);
  });
});

describe('stderr line formats', () => {
  it('formatRaceMessage round-trips through createRaceMessageRegex', () => {
    const line = formatRaceMessage('racer-a', '2.5', 'halfway there');
    const re = createRaceMessageRegex('racer-a');
    const m = re.exec(line);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('2.5');
    expect(m[2]).toBe('halfway there');
  });

  it('regex-escapes ids with special characters', () => {
    const id = 'a.b+c';
    const line = formatRaceMessage(id, '0.0', 'hi');
    expect(createRaceMessageRegex(id).exec(line)?.[2]).toBe('hi');
    // The dot must not match arbitrary characters
    expect(createRaceMessageRegex(id).exec(formatRaceMessage('aXb+c', '0.0', 'hi'))).toBeNull();
  });

  it('formatContextClosed produces the per-racer marker', () => {
    expect(formatContextClosed('lauda')).toBe('[lauda] Context closed');
  });
});

describe('runner.cjs config validation', () => {
  it('rejects a config with an unsafe racer id before doing any work', () => {
    const proc = runRunner({
      protocolVersion: PROTOCOL_VERSION,
      browsers: [{ id: '../escape', script: '' }],
      executionMode: 'sequential',
    });
    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('Unsafe racer id');
  });

  it('rejects a config without a protocol version', () => {
    const proc = runRunner({ browsers: [{ id: 'ok', script: '' }], executionMode: 'sequential' });
    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('protocol mismatch');
  });

  it('rejects a config with no browsers', () => {
    const proc = runRunner({ protocolVersion: PROTOCOL_VERSION, browsers: [], executionMode: 'sequential' });
    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('non-empty browsers array');
  });
});
