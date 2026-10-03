/* eslint-env browser */
/**
 * spreadsheet-panel.js — the Spreadsheet Export section's behaviour.
 *
 * The panel is rendered at build time (cli/spreadsheet-export.js): every
 * group's rows are already in the preview table, each with an include
 * checkbox keyed to its model row, and the export model sits in
 * #spreadsheet-data. This file only reacts: the row checkboxes decide what
 * is exported, the table checkboxes above tick and untick a whole group of
 * them (and show a mixed state when only some of a group are in), the
 * decimal option reformats the numbers, Copy puts tab-separated text or a
 * Markdown table on the clipboard and Download CSV hands over a file.
 * Everything textual comes from spreadsheet.cjs, so the clipboard and the
 * preview can never disagree about a value.
 *
 * Wrapped in its own scope: it is concatenated into the player runtime but
 * also inlined on the condition-matrix page, which has no player at all.
 */
(function initSpreadsheetPanel() {
  const root = document.getElementById('spreadsheetPanel');
  const dataEl = document.getElementById('spreadsheet-data');
  if (!root || !dataEl) return;
  let model;
  try { model = JSON.parse(dataEl.textContent); } catch { return; }

  const groupBoxes = Array.from(root.querySelectorAll('.spreadsheet-group input[type="checkbox"]'));
  const rowBoxes = Array.from(root.querySelectorAll('tbody input[data-row]'));
  const decimalBox = document.getElementById('spreadsheetDecimalComma');
  const status = document.getElementById('spreadsheetStatus');
  const numberCells = Array.from(root.querySelectorAll('td[data-value]'));
  // The byte-order mark is what makes Excel read a CSV as UTF-8, so a racer
  // called "café" keeps its accent. Spelled out, not typed: an invisible
  // character in the source is one an editor can silently drop.
  const BOM = String.fromCharCode(0xFEFF);

  /** The row checkboxes belonging to one group, by the group id on their row. */
  const rowBoxesOf = (groupId) => rowBoxes.filter(box => box.closest('tr').dataset.group === groupId);
  /** The keys of the ticked rows, in table order — what gets exported. */
  const selectedKeys = () => rowBoxes.filter(box => box.checked).map(box => box.dataset.row);
  /** The decimal mark the reader asked for. */
  const decimal = () => (decimalBox && decimalBox.checked ? ',' : '.');
  /** Put a line in the status output under the toolbar. */
  const say = (text) => { if (status) status.textContent = text; };
  /** "1 row" / "n rows". */
  const rowWord = (n) => (n === 1 ? '1 row' : n + ' rows');

  /** Strike out the rows that are left out, mirror each group's state onto its table checkbox, count the rest. */
  function sync() {
    rowBoxes.forEach(box => { box.closest('tr').classList.toggle('spreadsheet-excluded', !box.checked); });
    groupBoxes.forEach(box => {
      const rows = rowBoxesOf(box.value);
      const on = rows.filter(row => row.checked).length;
      box.checked = rows.length > 0 && on === rows.length;
      box.indeterminate = on > 0 && on < rows.length;
    });
    const count = selectedKeys().length;
    say(count === 0 ? 'Nothing selected.' : rowWord(count) + ' selected.');
  }

  /** Re-render every number in the preview with the current decimal mark. */
  function renderNumbers() {
    numberCells.forEach(td => { td.textContent = spreadsheetCell(Number(td.dataset.value), decimal()); });
  }

  /** Tick or untick every row of one group. */
  function setGroup(groupId, on) {
    rowBoxesOf(groupId).forEach(box => { box.checked = on; });
  }

  /**
   * Put text on the clipboard. navigator.clipboard needs a secure context; a
   * report opened over plain http from another machine falls back to the
   * selection-based copy. Resolves to whether either way worked.
   */
  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
    }
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.className = 'sr-only';
    // On <body>, not in the panel: the panel sits in a <details> that is
    // closed until opened, and a textarea inside a closed one is not
    // rendered, so it cannot be selected — and the run-by-run buttons copy
    // without the panel ever having been opened.
    document.body.appendChild(scratch);
    scratch.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    scratch.remove();
    return copied;
  }

  /** Copy the selected rows as tab-separated text (for a sheet) or Markdown (for GitHub). */
  async function copySelection(format) {
    const table = spreadsheetTable(model, selectedKeys());
    if (table.rows.length === 0) { say('Nothing selected — tick at least one row.'); return; }
    const markdown = format === 'markdown';
    const text = markdown
      ? spreadsheetMarkdown(table, { decimal: decimal() })
      : spreadsheetTsv(table, { decimal: decimal() });
    const ok = await copyText(text);
    if (!ok) { say('Copy failed — select the table below and copy it by hand.'); return; }
    say('Copied ' + rowWord(table.rows.length) + (markdown
      ? ' as Markdown — paste into a GitHub issue, pull request or README.'
      : ' — paste into a sheet.'));
  }

  /** Hand a table over as a CSV file named after the page; returns the file name. */
  function downloadTable(table) {
    const blob = new Blob([BOM, spreadsheetCsv(table, { decimal: decimal() })], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = spreadsheetFileName(document.title);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return link.download;
  }

  /** Download the selected rows as CSV and report the outcome. */
  function downloadCsv() {
    const table = spreadsheetTable(model, selectedKeys());
    if (table.rows.length === 0) { say('Nothing selected — tick at least one row.'); return; }
    const name = downloadTable(table);
    say('Downloaded ' + name + ' (' + rowWord(table.rows.length) + ').');
  }

  // --- Export buttons elsewhere on the page ---------------------------------
  // The run-by-run section carries its own copy/download buttons, each naming
  // the export-model groups it stands for; its Markdown copy is the tables as
  // shown rather than raw numbers. They report on the button itself,
  // since the panel's status line is nowhere near them.

  /** Briefly replace a button's label with an outcome, then put it back. */
  function flash(button, text) {
    if (button.dataset.flashing) return;
    const label = button.textContent;
    button.dataset.flashing = '1';
    button.textContent = text;
    setTimeout(() => { button.textContent = label; delete button.dataset.flashing; }, 1500);
  }

  /** Tick exactly these groups' rows in the panel, open it and scroll to it. */
  function pickGroups(groups) {
    const wanted = new Set(groups);
    rowBoxes.forEach(box => { box.checked = wanted.has(box.closest('tr').dataset.group); });
    sync();
    const section = root.closest('details');
    if (section) section.open = true;
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** A run-by-run table as the page shows it — trophies, gaps, bold summary rows. */
  function shownTable(table) {
    return {
      title: table.dataset.title,
      header: ['Run', ...(model.racerLabels || model.racers || [])],
      rows: Array.from(table.tBodies[0].rows).map(tr => ({
        bold: tr.classList.contains('run-comparison-median'),
        cells: Array.from(tr.cells).map(td => td.textContent.trim()),
      })),
    };
  }

  /** One click on a [data-spreadsheet-action] button: copy, download or pick its groups. */
  async function runAction(button) {
    let groups;
    try { groups = JSON.parse(button.dataset.spreadsheetGroups || '[]'); } catch { return; }
    const action = button.dataset.spreadsheetAction;
    if (action === 'pick') { pickGroups(groups); return; }
    const table = spreadsheetTable(model, groups);
    if (table.rows.length === 0) { flash(button, 'Nothing to export'); return; }
    if (action === 'download-csv') { downloadTable(table); flash(button, 'Downloaded'); return; }
    const wanted = new Set(groups);
    const text = action === 'copy-markdown'
      ? titledMarkdownTables(Array.from(document.querySelectorAll('.run-comparison-table[data-group]'))
        .filter(el => wanted.has(el.dataset.group))
        .map(shownTable))
      : spreadsheetTsv(table, { decimal: decimal() });
    flash(button, (await copyText(text)) ? 'Copied!' : 'Copy failed');
  }

  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-spreadsheet-action]');
    if (button && !root.contains(button)) runAction(button);
  });

  root.addEventListener('change', (e) => {
    const box = e.target;
    if (!box || !box.matches('input[type="checkbox"]')) return;
    if (box === decimalBox) { renderNumbers(); return; }
    if (box.closest('.spreadsheet-group')) setGroup(box.value, box.checked);
    sync();
  });
  root.addEventListener('click', (e) => {
    const selectAll = e.target.closest('[data-spreadsheet-select]');
    if (selectAll) {
      const on = selectAll.dataset.spreadsheetSelect === 'all';
      rowBoxes.forEach(box => { box.checked = on; });
      sync();
      return;
    }
    if (e.target.closest('#spreadsheetCopy')) copySelection('tsv');
    else if (e.target.closest('#spreadsheetMarkdown')) copySelection('markdown');
    else if (e.target.closest('#spreadsheetCsv')) downloadCsv();
  });

  sync();
})();
