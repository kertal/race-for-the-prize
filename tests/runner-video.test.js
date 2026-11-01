import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { assertSafeFfmpegArgs } = require('../runner-video.cjs');

// runFfmpeg validates its arguments through assertSafeFfmpegArgs BEFORE
// spawning, so this pure guard is testable without ffmpeg installed.
describe('assertSafeFfmpegArgs', () => {
  const dir = path.join(os.tmpdir(), 'rftp-ffmpeg-args');

  it('rejects a path argument that escapes the recording directory', () => {
    expect(() => assertSafeFfmpegArgs(['-i', path.join(os.tmpdir(), 'elsewhere.webm')], dir))
      .toThrow(/escapes/);
  });

  it('rejects a sibling directory sharing the root as a prefix', () => {
    expect(() => assertSafeFfmpegArgs(['-i', `${dir}-evil/x.webm`], dir)).toThrow(/escapes/);
  });

  it('rejects an absolute argument that traverses back out of the root', () => {
    // A raw string-prefix test accepts this: it starts with root but resolves
    // outside it.
    expect(() => assertSafeFfmpegArgs(['-i', `${dir}/../outside.webm`], dir)).toThrow(/escapes/);
    expect(() => assertSafeFfmpegArgs(['-i', `${dir}/sub/../../outside.webm`], dir)).toThrow(/escapes/);
  });

  it('accepts an absolute argument that traverses but stays inside the root', () => {
    expect(() => assertSafeFfmpegArgs(['-i', `${dir}/sub/../in.webm`], dir)).not.toThrow();
  });

  it('accepts children when the recording dir is the filesystem root', () => {
    // A `root + path.sep` prefix becomes '//' for a root dir and rejected every
    // valid child path.
    const fsRoot = path.parse(dir).root;
    expect(() => assertSafeFfmpegArgs(['-i', path.join(fsRoot, 'video.webm')], fsRoot)).not.toThrow();
  });

  it("accepts an in-root file whose name starts with '..'", () => {
    // path.relative returns '..hidden.webm' here, which a naive startsWith('..')
    // would read as an escape.
    expect(() => assertSafeFfmpegArgs(['-i', `${dir}/..hidden.webm`], dir)).not.toThrow();
  });

  it('rejects a non-path argument that could be read as an option', () => {
    // A relative value with a separator is neither a confined path nor a
    // plain flag/name/number.
    expect(() => assertSafeFfmpegArgs(['-i', '../evil.webm'], dir)).toThrow(/unexpected argument/);
    expect(() => assertSafeFfmpegArgs(['--attacker-supplied=/etc/passwd'], dir)).toThrow(/unexpected argument/);
  });

  it('rejects non-string and empty arguments', () => {
    expect(() => assertSafeFfmpegArgs([42], dir)).toThrow(/not a non-empty string/);
    expect(() => assertSafeFfmpegArgs([''], dir)).toThrow(/not a non-empty string/);
    expect(() => assertSafeFfmpegArgs([undefined], dir)).toThrow(/not a non-empty string/);
  });

  it('accepts the real trim argument shapes (flags, codecs, numbers, confined paths)', () => {
    // The arguments extractSegments actually builds must pass validation.
    const args = [
      '-y', '-i', path.join(dir, 'in.webm'),
      '-ss', '1.500', '-t', '2.250',
      '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
      path.join(dir, 'out.webm'),
    ];
    expect(() => assertSafeFfmpegArgs(args, dir)).not.toThrow();
  });

  it('accepts the concat argument shape', () => {
    const args = [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', path.join(dir, 'list.txt'), '-c', 'copy', path.join(dir, 'final.webm'),
    ];
    expect(() => assertSafeFfmpegArgs(args, dir)).not.toThrow();
  });
});
