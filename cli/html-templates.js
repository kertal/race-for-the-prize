/**
 * html-templates.js — the report generators' shared markup plumbing.
 *
 * Every generated page keeps its markup in a real `.html` file rather than in
 * JavaScript string literals: the page shell, plus one `<template id="build-…">`
 * per repeated fragment. This module loads such a file, splits the shell from
 * the fragments, and fills `{{placeholder}}` slots in either.
 *
 * Keeping the markup in `.html` means editors, formatters and linters can see
 * it, and a fragment's structure is readable without mentally un-escaping a
 * template literal.
 */

import fs from 'node:fs';

// A comment directly above a build template documents it, so it is consumed
// with the template rather than left behind in the page shell.
const BUILD_TEMPLATE_RE =
  /(?:<!--[\s\S]*?-->\s*)?<template id="build-([^"]+)">([\s\S]*?)<\/template>\s*/g;

/**
 * Replace `{{key}}` placeholders in a template string with data values.
 *
 * IMPORTANT: This does NOT auto-escape values. Callers MUST use escHtml() on
 * any user-supplied string before passing it as a data value. Pre-built HTML
 * snippets (for example nested template output) are passed through as-is.
 */
export function render(tmpl, data) {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? '');
}

/** Escape a string for safe embedding in HTML text/attribute contexts. */
export function escHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Split a markup file into its page shell and its build-time fragments.
 *
 * @param {string} html - contents of a `.html` file
 * @returns {{shell: string, templates: Record<string, string>}}
 *   `shell` is the document with the `<template id="build-…">` elements
 *   removed; `templates` maps each id suffix to that fragment's inner markup.
 */
export function splitTemplates(html) {
  const templates = {};
  const shell = html.replace(BUILD_TEMPLATE_RE, (_, id, content) => {
    // Drop only the newline that follows the opening tag and the indented
    // newline before the closing one. A fragment's own leading indentation and
    // any significant trailing space (a separator before the next slot) are
    // part of it, so the generated document keeps the shape the file shows.
    templates[id] = content.replace(/^\n/, '').replace(/\n[^\S\n]*$/, '');
    return '';
  });
  return { shell, templates };
}

/**
 * Load a markup file and return its shell plus a bound renderer for its
 * fragments. `fill(id, data)` renders one fragment by its `build-<id>` name and
 * throws for an unknown id, so a renamed template fails loudly at build time
 * instead of silently emitting an empty string.
 *
 * @param {string} filePath - absolute path to the `.html` file
 */
export function loadTemplates(filePath) {
  const { shell, templates } = splitTemplates(fs.readFileSync(filePath, 'utf-8'));
  const fill = (id, data = {}) => {
    if (!(id in templates)) {
      throw new Error(`No <template id="build-${id}"> in ${filePath}`);
    }
    return render(templates[id], data);
  };
  return { shell, templates, fill };
}
