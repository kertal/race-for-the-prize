import { describe, it, expect } from 'vitest';
import { parseCredits, renderInline, renderCreditsPage } from '../scripts/build-credits.js';

const SAMPLE = `# Credits

<!-- a note for editors, never for readers -->

No car reaches the grid on its own.

## 🔧 The crew

Built by [@kertal](https://github.com/kertal).

A second thought, still about the crew.

## 💡 The spark

[@drew](https://github.com/drew) — whose work
sparked it.

## 🧪 The QA

Simon & Werner — "it works on my computer" isn't a case.
`;

describe('parseCredits', () => {
  const page = parseCredits(SAMPLE);

  it('reads the title and the intro paragraph', () => {
    expect(page.title).toBe('Credits');
    expect(page.intro).toEqual(['No car reaches the grid on its own.']);
  });

  it('turns every ## into a section holding the paragraphs below it', () => {
    expect(page.sections.map(s => s.heading)).toEqual(['🔧 The crew', '💡 The spark', '🧪 The QA']);
    expect(page.sections[0].paragraphs).toEqual([
      'Built by [@kertal](https://github.com/kertal).',
      'A second thought, still about the crew.',
    ]);
  });

  it('joins soft line breaks inside a paragraph', () => {
    expect(page.sections[1].paragraphs).toEqual(['[@drew](https://github.com/drew) — whose work sparked it.']);
  });

  it('drops HTML comments', () => {
    expect(JSON.stringify(page)).not.toContain('a note for editors');
  });

  it('refuses Markdown the page has no markup for', () => {
    for (const line of ['### a sub-heading', '- a list item', '1. a numbered one', '> a quote', '```', '| a | table |', '---']) {
      expect(() => parseCredits(`# T\n\n${line}\n`), line).toThrow(/cannot render/);
    }
  });

  it('insists on the shape it renders', () => {
    expect(() => parseCredits('No title here.\n')).toThrow(/title/);
    expect(() => parseCredits('')).toThrow(/title/);
    expect(() => parseCredits('Stray prose first.\n\n# Credits\n')).toThrow(/start with a "# " title, not: "Stray prose first."/);
    expect(() => parseCredits('## A section first\n\n# Credits\n')).toThrow(/start with a "# " title, not: "## A section first"/);
    expect(() => parseCredits('# One\n\n# Two\n')).toThrow(/second title/);
    expect(() => parseCredits('# T\n\n## Section\nglued paragraph\n')).toThrow(/blank line/);
  });
});

describe('renderInline', () => {
  it('turns links into anchors and escapes the rest', () => {
    expect(renderInline('see [a & b](https://x.y/?a=1&b=2) <now>'))
      .toBe('see <a href="https://x.y/?a=1&amp;b=2">a &amp; b</a> &lt;now&gt;');
  });

  it('leaves quotes alone in text, so the generated file reads like the Markdown', () => {
    expect(renderInline(`"it works" isn't a case`)).toBe(`"it works" isn't a case`);
  });

  it('only links to http(s) URLs, so no script can ride in on a credit', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,hi', 'index.html', '//evil.example']) {
      expect(() => renderInline(`[x](${href})`), href).toThrow(/not an http\(s\) URL/);
    }
    expect(renderInline('[ok](http://a.b) [ok](https://a.b/c?d=1)')).toContain('href="https://a.b/c?d=1"');
  });
});

describe('renderCreditsPage', () => {
  const html = renderCreditsPage(SAMPLE);

  it('fills the shell and leaves no fragment or placeholder behind', () => {
    expect(html).toContain('<title>Credits — RaceForThePrize</title>');
    expect(html).toContain('<p class="tagline">No car reaches the grid on its own.</p>');
    expect(html).not.toContain('<template');
    expect(html).not.toMatch(/\{\{\w+\}\}/);
  });

  it('escapes the title for the attributes it lands in', () => {
    const html = renderCreditsPage('# A "quoted" & <odd> title\n');
    expect(html).toContain('<title>A &quot;quoted&quot; &amp; &lt;odd&gt; title — RaceForThePrize</title>');
    expect(html).toContain('content="RaceForThePrize — A &quot;quoted&quot; &amp; &lt;odd&gt; title"');
    expect(html).not.toContain('"quoted"');
  });

  it('renders one section per heading, with its paragraphs and links', () => {
    expect(html).toContain(
      '  <section>\n    <h2>🔧 The crew</h2>\n    <p>Built by <a href="https://github.com/kertal">@kertal</a>.</p>\n    <p>A second thought, still about the crew.</p>\n  </section>'
    );
    expect(html).toContain('<h2>🧪 The QA</h2>\n    <p>Simon &amp; Werner — "it works on my computer" isn\'t a case.</p>');
    expect(html.match(/<section>/g)).toHaveLength(3);
  });
});
