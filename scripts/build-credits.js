#!/usr/bin/env node
/**
 * build-credits.js — renders docs/credits.md into docs/credits.html.
 *
 * GitHub Pages serves docs/ with .nojekyll, so the handbook's Markdown is
 * deployed but never rendered — and the credits are the one page the site has
 * to show. Rather than keep a hand-written twin in step, credits.md is the only
 * copy anyone edits and this script writes the HTML from it. Run it with
 * `npm run build:credits` and commit both files; tests/site.test.js fails
 * while the committed HTML is stale.
 *
 * The page shell and its fragments live in credits-page.html next to this
 * file. Only the Markdown the credits use is understood — a `#` title, `##`
 * headings, paragraphs, `[text](url)` links and HTML comments — and anything
 * else is refused rather than rendered wrong. Each `##` becomes a section
 * holding the paragraphs below it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escHtml, loadTemplates, render } from '../cli/html-templates.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CREDITS_MD = path.join(HERE, '..', 'docs', 'credits.md');
export const CREDITS_HTML = path.join(HERE, '..', 'docs', 'credits.html');
const PAGE = path.join(HERE, 'credits-page.html');

const HEADING_RE = /^(#{1,2})\s+(.+?)\s*$/;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
// Deeper headings, lists, blockquotes, fences, tables and rules: Markdown the
// page has no markup for, so a line starting one stops the build instead of
// leaking through as a paragraph.
const UNSUPPORTED_RE = /^\s*(?:#{3,}\s|[-*+]\s|\d+[.)]\s|>|```|\||---)/;

/** Text-node escaping: quotes stay readable in the generated file. */
const escText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Inline Markdown → HTML: escaped text with `[text](url)` turned into anchors. */
export function renderInline(text) {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const [whole, label, href] = match;
    html += escText(text.slice(last, match.index)) + `<a href="${escHtml(href)}">${escText(label)}</a>`;
    last = match.index + whole.length;
  }
  return html + escText(text.slice(last));
}

/**
 * Read the credits' Markdown into a page model:
 * `{ title, intro: [paragraph], sections: [{ heading, paragraphs }] }`.
 * Soft line breaks inside a paragraph are joined with a space.
 */
export function parseCredits(markdown) {
  const page = { title: '', intro: [], sections: [] };
  let section = null;

  const blocks = markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const unsupported = lines.find(line => UNSUPPORTED_RE.test(line));
    if (unsupported) {
      throw new Error(`credits.md uses Markdown the credits page cannot render: "${unsupported}"`);
    }

    const heading = lines[0].match(HEADING_RE);
    if (heading) {
      if (lines.length > 1) throw new Error(`credits.md heading needs a blank line after it: "${lines[0]}"`);
      const [, level, text] = heading;
      if (level === '#') {
        if (page.title) throw new Error(`credits.md has a second title: "${text}"`);
        page.title = text;
      } else {
        section = { heading: text, paragraphs: [] };
        page.sections.push(section);
      }
      continue;
    }

    const paragraph = lines.join(' ');
    if (section) section.paragraphs.push(paragraph);
    else page.intro.push(paragraph);
  }

  if (!page.title) throw new Error('credits.md has to start with a "# " title');
  return page;
}

/** Render the credits' Markdown into the full HTML page. */
export function renderCreditsPage(markdown, pagePath = PAGE) {
  const { shell, fill } = loadTemplates(pagePath);
  const page = parseCredits(markdown);

  const sections = page.sections.map(section => fill('section', {
    heading: renderInline(section.heading),
    body: section.paragraphs.map(text => fill('paragraph', { text: renderInline(text) })).join('\n'),
  })).join('\n\n');

  return render(shell, {
    title: escText(page.title),
    tagline: page.intro.map(text => fill('tagline', { text: renderInline(text) })).join('\n'),
    sections,
  });
}

/** Write docs/credits.html from docs/credits.md and return the HTML. */
export function buildCreditsPage() {
  const html = renderCreditsPage(fs.readFileSync(CREDITS_MD, 'utf8'));
  fs.writeFileSync(CREDITS_HTML, html);
  return html;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCreditsPage();
  console.log(`Wrote ${path.relative(process.cwd(), CREDITS_HTML)} from ${path.relative(process.cwd(), CREDITS_MD)}`);
}
