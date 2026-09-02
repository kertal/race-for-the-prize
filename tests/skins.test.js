import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSkins, resolveSkin, DEFAULT_THEME_COLOR, SKINS_DIR } from '../cli/skins.js';
import { applyOverrides, InvalidSettingError } from '../cli/config.js';
import { buildPlayerHtml } from '../cli/videoplayer.js';

const summary = () => ({
  racers: ['lauda', 'hunt'],
  comparisons: [],
  overallWinner: 'lauda',
  timestamp: '2025-01-15T12:00:00.000Z',
  settings: {},
  errors: [],
  wins: {},
  videos: {},
});
const videoFiles = ['lauda/lauda.race.webm', 'hunt/hunt.race.webm'];

function withTempSkin(css, fn, filename = 'team.css') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-skin-'));
  const file = path.join(dir, filename);
  fs.writeFileSync(file, css);
  try {
    return fn(file, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('listSkins', () => {
  it('lists the built-in skins', () => {
    expect(listSkins()).toEqual(expect.arrayContaining(['light', 'neon']));
  });

  it('matches the .css files actually shipped in cli/skins', () => {
    const onDisk = fs.readdirSync(SKINS_DIR).filter(f => f.endsWith('.css')).map(f => path.basename(f, '.css')).sort();
    expect(listSkins()).toEqual(onDisk);
  });
});

describe('resolveSkin', () => {
  it('returns null when no skin is requested', () => {
    expect(resolveSkin(undefined)).toBeNull();
    expect(resolveSkin(null)).toBeNull();
    expect(resolveSkin('')).toBeNull();
    expect(resolveSkin('   ')).toBeNull();
  });

  it('loads a built-in skin by name', () => {
    const skin = resolveSkin('light');
    expect(skin.name).toBe('light');
    expect(skin.css).toContain(':root[data-theme="light"]');
    expect(skin.source).toBe(path.join(SKINS_DIR, 'light.css'));
  });

  it('reads the theme colour from the skin --bg token', () => {
    expect(resolveSkin('light').themeColor).toBe('#f6f3ec');
    expect(resolveSkin('neon').themeColor).toBe('#0d0a1f');
  });

  it('falls back to the default theme colour when --bg is not a literal', () => {
    withTempSkin(':root { --bg: var(--color-ink-900); }', (file) => {
      expect(resolveSkin(file).themeColor).toBe(DEFAULT_THEME_COLOR);
    });
  });

  it('rejects an unknown built-in name and names the alternatives', () => {
    expect(() => resolveSkin('chartreuse')).toThrow(InvalidSettingError);
    expect(() => resolveSkin('chartreuse')).toThrow(/Built-in skins: light, neon/);
  });

  it('rejects a name that is not filename-safe', () => {
    expect(() => resolveSkin('../../etc/passwd')).toThrow(InvalidSettingError);
    expect(() => resolveSkin('a b')).toThrow(InvalidSettingError);
  });

  it('rejects a non-string skin', () => {
    expect(() => resolveSkin(42)).toThrow(InvalidSettingError);
  });

  it('loads a skin from a .css path', () => {
    withTempSkin(':root { --accent: #00ff00; }', (file) => {
      const skin = resolveSkin(file);
      expect(skin.name).toBe('team');
      expect(skin.css).toContain('#00ff00');
    });
  });

  it('resolves a relative .css path against the race directory first', () => {
    withTempSkin(':root { --accent: #00ff00; }', (file, dir) => {
      const skin = resolveSkin('team.css', dir);
      expect(skin.source).toBe(file);
    });
  });

  it('reports a missing skin file', () => {
    expect(() => resolveSkin('./nope.css')).toThrow(/Skin file not found/);
  });

  it('refuses CSS that would break out of the inline <style> block', () => {
    withTempSkin(':root { --accent: red; } </style><script>alert(1)</script>', (file) => {
      expect(() => resolveSkin(file)).toThrow(/cannot be inlined/);
    });
  });
});

describe('--skin CLI flag', () => {
  it('is carried through applyOverrides', () => {
    expect(applyOverrides({}, new Set(), { skin: 'light' }).skin).toBe('light');
  });

  it('trims surrounding whitespace', () => {
    expect(applyOverrides({}, new Set(), { skin: '  neon  ' }).skin).toBe('neon');
  });

  it('rejects an empty value', () => {
    expect(() => applyOverrides({}, new Set(), { skin: '  ' })).toThrow(InvalidSettingError);
  });

  it('leaves skin unset when the flag is absent', () => {
    expect(applyOverrides({}, new Set(), {}).skin).toBeUndefined();
  });
});

describe('buildPlayerHtml skinning', () => {
  it('emits no skin style block and the default theme colour by default', () => {
    const html = buildPlayerHtml(summary(), videoFiles);
    expect(html).not.toContain('id="rftp-skin"');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(`<meta name="theme-color" content="${DEFAULT_THEME_COLOR}">`);
  });

  it('stamps data-theme on <html> and inlines the skin after the base stylesheet', () => {
    const html = buildPlayerHtml(summary(), videoFiles, null, null, { skin: 'neon' });
    expect(html).toContain('<html lang="en" data-theme="neon">');
    expect(html).toContain('<style id="rftp-skin">');
    expect(html).toContain(':root[data-theme="neon"]');
    expect(html).toContain('<meta name="theme-color" content="#0d0a1f">');
    // The skin must come after the base stylesheet so its tokens win
    expect(html.indexOf('id="rftp-skin"')).toBeGreaterThan(html.indexOf('--color-gold:'));
  });

  it('accepts a custom skin file relative to the race directory', () => {
    withTempSkin(':root { --accent: #00ff00; }', (_file, dir) => {
      const html = buildPlayerHtml(summary(), videoFiles, null, null, { skin: 'team.css', skinBaseDir: dir });
      expect(html).toContain('data-theme="team"');
      expect(html).toContain('--accent: #00ff00;');
    });
  });

  it('propagates an invalid skin as an InvalidSettingError', () => {
    expect(() => buildPlayerHtml(summary(), videoFiles, null, null, { skin: 'nope' })).toThrow(InvalidSettingError);
  });
});

describe('player.css design tokens', () => {
  const css = fs.readFileSync(path.join(SKINS_DIR, '..', 'player.css'), 'utf-8');
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('3. Components'));
  const componentCss = css.slice(css.indexOf('3. Components'));

  it('declares the semantic roles skins are expected to override', () => {
    for (const token of ['--bg', '--surface', '--text', '--accent', '--border', '--font-ui', '--font-display', '--radius', '--tool-accent']) {
      expect(rootBlock).toContain(`${token}:`);
    }
  });

  it('keeps literal colours out of the component layer', () => {
    const literals = componentCss
      .split('\n')
      .filter(line => !line.includes('svg') && /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(line));
    expect(literals).toEqual([]);
  });

  it('every built-in skin only redefines tokens that exist in the base stylesheet', () => {
    for (const name of listSkins()) {
      const skinCss = resolveSkin(name).css;
      const declared = [...skinCss.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(m => m[1]);
      expect(declared.length).toBeGreaterThan(0);
      for (const token of declared) {
        expect(rootBlock, `skin "${name}" declares unknown token ${token}`).toContain(`${token}:`);
      }
    }
  });
});
