import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, escHtml, splitTemplates, loadTemplates } from '../cli/html-templates.js';

const CLI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli');

describe('render', () => {
  it('fills placeholders', () => {
    expect(render('<i>{{a}}/{{b}}</i>', { a: '1', b: '2' })).toBe('<i>1/2</i>');
  });

  it('repeats a placeholder used more than once', () => {
    expect(render('{{x}}-{{x}}', { x: 'a' })).toBe('a-a');
  });

  it('renders a missing or null value as empty', () => {
    expect(render('[{{a}}][{{b}}]', { a: null })).toBe('[][]');
  });

  it('leaves a value that itself looks like a placeholder alone', () => {
    // A single pass, so an injected {{…}} is not re-expanded.
    expect(render('{{a}}', { a: '{{b}}', b: 'no' })).toBe('{{b}}');
  });
});

describe('escHtml', () => {
  it('escapes every character that could break out of markup', () => {
    expect(escHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('escapes ampersands first so entities are not double-built', () => {
    expect(escHtml('&lt;')).toBe('&amp;lt;');
  });

  it('coerces non-strings', () => {
    expect(escHtml(42)).toBe('42');
  });
});

describe('splitTemplates', () => {
  it('lifts build-* fragments out of the shell', () => {
    const { shell, templates } = splitTemplates('<p>{{a}}</p><template id="build-x"><i>{{v}}</i></template>');
    expect(shell).toBe('<p>{{a}}</p>');
    expect(templates).toEqual({ x: '<i>{{v}}</i>' });
  });

  it('keeps a fragment’s own indentation but drops the wrapper newlines', () => {
    const { templates } = splitTemplates('<template id="build-x">\n  <div>\n    <i>hi</i>\n  </div>\n</template>');
    expect(templates.x).toBe('  <div>\n    <i>hi</i>\n  </div>');
  });

  it('keeps a significant trailing space on the last line', () => {
    // The trophy fragment ends with the space that separates it from the name.
    const { templates } = splitTemplates('<template id="build-x"><b>!</b> </template>');
    expect(templates.x).toBe('<b>!</b> ');
  });

  it('consumes a comment that documents the template', () => {
    const { shell, templates } = splitTemplates('<p>keep</p>\n<!-- why -->\n<template id="build-x">a</template>');
    expect(shell.trim()).toBe('<p>keep</p>');
    expect(templates.x).toBe('a');
  });

  it('leaves an unrelated <template> alone', () => {
    const { shell, templates } = splitTemplates('<template id="tmpl-runtime">x</template>');
    expect(shell).toBe('<template id="tmpl-runtime">x</template>');
    expect(templates).toEqual({});
  });
});

describe('loadTemplates', () => {
  const withFile = (html, fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rftp-tmpl-'));
    const file = path.join(dir, 'page.html');
    fs.writeFileSync(file, html);
    try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };

  it('returns the shell and a bound filler', () => {
    withFile('<p>{{body}}</p><template id="build-row"><i>{{v}}</i></template>', (file) => {
      const { shell, fill } = loadTemplates(file);
      expect(render(shell, { body: fill('row', { v: 'x' }) })).toBe('<p><i>x</i></p>');
    });
  });

  it('throws for an unknown fragment rather than emitting nothing', () => {
    withFile('<template id="build-row">x</template>', (file) => {
      const { fill } = loadTemplates(file);
      expect(() => fill('typo')).toThrow(/No <template id="build-typo">/);
    });
  });

  it('renders a fragment with no data', () => {
    withFile('<template id="build-row"><hr></template>', (file) => {
      expect(loadTemplates(file).fill('row')).toBe('<hr>');
    });
  });
});

describe('markup stays out of the JavaScript', () => {
  // The report generators keep their markup in .html files and their styling in
  // .css files. These guards stop either creeping back into a template literal.
  const generators = ['player-sections.js', 'videoplayer.js', 'condition-matrix.js'];

  const codeLines = (file) =>
    fs.readFileSync(path.join(CLI_DIR, file), 'utf-8')
      .split('\n')
      // Drop comment lines: prose about markup is fine, emitting it is not.
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line));

  it.each(generators)('%s builds no classed markup inline', (file) => {
    // Any element carrying a CSS class belongs in a build-* fragment, so that
    // markup and the stylesheet can be read side by side.
    const offenders = codeLines(file).filter(line => /<[a-z][a-z0-9]*[^>]*\sclass=/.test(line));
    expect(offenders).toEqual([]);
  });

  it.each(generators)('%s declares no CSS rules inline', (file) => {
    // A CSS declaration inside a block: `{ prop: value;`. Object literals in
    // JavaScript separate their properties with commas, so they do not match.
    // HTML entities carry their own semicolon, so drop those first.
    const offenders = codeLines(file)
      .filter(line => /[{;]\s*[a-z-]+:\s*[^;{}]+;/.test(line.replaceAll(/&#?[a-z0-9]+;/gi, '')));
    expect(offenders).toEqual([]);
  });

  it('every build-* fragment in a markup file is actually used', () => {
    const pages = { 'player.html': ['player-sections.js', 'videoplayer.js'], 'condition-matrix.html': ['condition-matrix.js'] };
    for (const [page, users] of Object.entries(pages)) {
      const { templates } = loadTemplates(path.join(CLI_DIR, page));
      const js = users.map(f => fs.readFileSync(path.join(CLI_DIR, f), 'utf-8')).join('\n');
      const unused = Object.keys(templates).filter(id => !js.includes(`'${id}'`));
      expect(unused, `unused fragments in ${page}`).toEqual([]);
    }
  });

  it('every fragment a generator asks for exists in its markup file', () => {
    const pages = { 'player.html': ['player-sections.js', 'videoplayer.js'], 'condition-matrix.html': ['condition-matrix.js'] };
    for (const [page, users] of Object.entries(pages)) {
      const { templates } = loadTemplates(path.join(CLI_DIR, page));
      for (const file of users) {
        const js = fs.readFileSync(path.join(CLI_DIR, file), 'utf-8');
        const asked = [...js.matchAll(/\bfill\('([a-z0-9-]+)'/g)].map(m => m[1]);
        const missing = asked.filter(id => !(id in templates));
        expect(missing, `${file} -> ${page}`).toEqual([]);
      }
    }
  });
});
