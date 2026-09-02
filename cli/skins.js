/**
 * Skin resolution for the results player.
 *
 * A skin is a plain CSS file that redefines the design tokens declared at the
 * top of cli/player.css. It is inlined after the base stylesheet, so it needs
 * nothing but token overrides — no component rules, no build step.
 *
 * A skin can be:
 *   - a built-in name        e.g. "light"  -> cli/skins/light.css
 *   - a path to a .css file  e.g. "./team.css" (relative to the race directory,
 *                            then to the current working directory)
 *
 * Skins are scoped by `:root[data-theme="<name>"]`; buildPlayerHtml stamps that
 * name onto <html> so several skins can coexist in one document.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { InvalidSettingError } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SKINS_DIR = path.join(__dirname, 'skins');

/** theme-color meta value used when no skin overrides the page background. */
export const DEFAULT_THEME_COLOR = '#1a1a1a';

/** Names of the skins shipped with RaceForThePrize, sorted. */
export function listSkins() {
  try {
    return fs.readdirSync(SKINS_DIR)
      .filter(f => f.endsWith('.css'))
      .map(f => path.basename(f, '.css'))
      .sort();
  } catch {
    return [];
  }
}

/** A skin name must be usable as both a filename and a data-theme value. */
function assertSafeName(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw new InvalidSettingError(
      `Invalid skin name "${name}". Use letters, digits, dot, dash or underscore, or pass a path to a .css file.`
    );
  }
}

/**
 * Pull the page background out of a skin so the browser's theme-color meta
 * matches it. Only a literal colour counts — a var() reference cannot be
 * resolved without a layout engine, so those fall back to the default.
 */
function extractThemeColor(css) {
  const match = /--bg:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-zA-Z]+)\s*[;}]/.exec(css);
  return match ? match[1] : DEFAULT_THEME_COLOR;
}

/**
 * Resolve a skin selector to its name and CSS.
 *
 * @param {string|null|undefined} skin - built-in name or path to a .css file
 * @param {string} [baseDir] - directory a relative path is resolved against first
 * @returns {{name: string, css: string, themeColor: string, source: string}|null}
 *          null when no skin was requested
 * @throws {InvalidSettingError} for an unknown name, a missing file, or CSS that
 *         cannot be inlined safely
 */
export function resolveSkin(skin, baseDir) {
  if (skin === null || skin === undefined || skin === '') return null;
  if (typeof skin !== 'string') {
    throw new InvalidSettingError(`--skin must be a skin name or a path to a .css file, got ${typeof skin}`);
  }

  const value = skin.trim();
  if (value === '') return null;

  let source;
  let name;

  if (value.toLowerCase().endsWith('.css')) {
    const candidates = baseDir
      ? [path.resolve(baseDir, value), path.resolve(value)]
      : [path.resolve(value)];
    source = candidates.find(p => fs.existsSync(p));
    if (!source) {
      throw new InvalidSettingError(`Skin file not found: ${value} (looked in ${candidates.join(', ')})`);
    }
    name = path.basename(source, '.css');
    assertSafeName(name);
  } else {
    assertSafeName(value);
    source = path.join(SKINS_DIR, `${value}.css`);
    if (!fs.existsSync(source)) {
      const available = listSkins().join(', ') || 'none';
      throw new InvalidSettingError(`Unknown skin "${value}". Built-in skins: ${available}. Or pass a path to a .css file.`);
    }
    name = value;
  }

  const css = fs.readFileSync(source, 'utf-8');
  // The skin is inlined in a <style> block, so a literal close tag would end it
  // early and let the rest of the file render as markup.
  if (/<\/style/i.test(css)) {
    throw new InvalidSettingError(`Skin "${name}" contains a </style> sequence and cannot be inlined: ${source}`);
  }

  return { name, css, themeColor: extractThemeColor(css), source };
}
