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
// Every credit links out to a website, so anything else — `javascript:` above
// all — is a mistake, and the build says so rather than publishing it.
const LINK_SCHEME_RE = /^https?:\/\//;
// Deeper headings, lists, blockquotes, fences, tables and rules: Markdown the
// page has no markup for, so a line starting one stops the build instead of
// leaking through as a paragraph.
const UNSUPPORTED_RE = /^\s*(?:#{3,}\s|[-*+]\s|\d+[.)]\s|>|```|\||---)/;

/** Text-node escaping: quotes stay readable in the generated file. */
const escText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * Inline Markdown → HTML: escaped text with `[text](url)` turned into anchors,
 * each rendered through the page's `build-link` fragment via `fill`.
 */
export function renderInline(text, fill) {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const [whole, label, href] = match;
    if (!LINK_SCHEME_RE.test(href)) throw new Error(`credits.md link is not an http(s) URL: "${href}"`);
    html += escText(text.slice(last, match.index)) + fill('link', { href: escHtml(href), label: escText(label) });
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

    // A heading is a block of its own: one glued to a paragraph, on whichever
    // line, would otherwise be published as prose.
    const glued = lines.length > 1 && lines.find(line => HEADING_RE.test(line));
    if (glued) throw new Error(`credits.md heading needs blank lines around it: "${glued}"`);
    const heading = lines[0].match(HEADING_RE);
    // The title opens the file: anything else first is a malformed edit.
    if (!page.title && heading?.[1] !== '#') {
      throw new Error(`credits.md has to start with a "# " title, not: "${lines[0]}"`);
    }
    if (heading) {
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
  const inline = text => renderInline(text, fill);

  const sections = page.sections.map(section => fill('section', {
    heading: inline(section.heading),
    body: section.paragraphs.map(text => fill('paragraph', { text: inline(text) })).join('\n'),
  })).join('\n\n');

  return render(shell, {
    // The title also lands in attributes (og:title), so quotes are escaped too.
    title: escHtml(page.title),
    tagline: page.intro.map(text => fill('tagline', { text: inline(text) })).join('\n'),
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
