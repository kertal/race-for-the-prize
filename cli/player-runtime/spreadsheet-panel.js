/* eslint-env browser */
/**
 * spreadsheet-panel.js — the Spreadsheet Export section's behaviour.
 *
 * The panel is rendered at build time (cli/spreadsheet-export.js): every
 * group's rows are already in the preview table, tagged with their group id,
 * and the export model sits in #spreadsheet-data. This file only reacts:
 * ticking a group shows or hides its rows, the decimal option reformats the
 * numbers, Copy puts tab-separated text on the clipboard and Download CSV
 * hands over a file. Everything textual comes from spreadsheet.cjs, so the
 * clipboard and the preview can never disagree about a value.
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

  const boxes = Array.from(root.querySelectorAll('.spreadsheet-group input[type="checkbox"]'));
  const decimalBox = document.getElementById('spreadsheetDecimalComma');
  const status = document.getElementById('spreadsheetStatus');
  const rows = Array.from(root.querySelectorAll('tbody tr[data-group]'));
  const numberCells = Array.from(root.querySelectorAll('td[data-value]'));

  /** The ids of the ticked groups, in panel order. */
  const selectedIds = () => boxes.filter(box => box.checked).map(box => box.value);
  /** The decimal mark the reader asked for. */
  const decimal = () => (decimalBox && decimalBox.checked ? ',' : '.');
  /** Put a line in the status output under the toolbar. */
  const say = (text) => { if (status) status.textContent = text; };
  /** "1 row" / "n rows". */
  const rowWord = (n) => (n === 1 ? '1 row' : n + ' rows');

  /** Show the ticked groups' rows, reformat the numbers, and count what would be copied. */
  function sync() {
    const selected = new Set(selectedIds());
    rows.forEach(tr => { tr.hidden = !selected.has(tr.dataset.group); });
    numberCells.forEach(td => { td.textContent = spreadsheetCell(Number(td.dataset.value), decimal()); });
    const count = spreadsheetTable(model, selectedIds()).rows.length;
    say(count === 0 ? 'Nothing selected.' : rowWord(count) + ' selected.');
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
    root.appendChild(scratch);
    scratch.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    scratch.remove();
    return copied;
  }

  /** Copy the selected tables as tab-separated text and report the outcome. */
  async function copySelection() {
    const table = spreadsheetTable(model, selectedIds());
    if (table.rows.length === 0) { say('Nothing selected — tick at least one table.'); return; }
    const ok = await copyText(spreadsheetTsv(table, { decimal: decimal() }));
    say(ok
      ? 'Copied ' + rowWord(table.rows.length) + ' — paste into a sheet.'
      : 'Copy failed — select the table below and copy it by hand.');
  }

  /** Hand the selected tables over as a CSV file named after the page. */
  function downloadCsv() {
    const table = spreadsheetTable(model, selectedIds());
    if (table.rows.length === 0) { say('Nothing selected — tick at least one table.'); return; }
    // The byte-order mark is what makes Excel read the file as UTF-8, so a
    // racer called "café" keeps its accent.
    const blob = new Blob(['﻿', spreadsheetCsv(table, { decimal: decimal() })], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = spreadsheetFileName(document.title);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('Downloaded ' + link.download + ' (' + rowWord(table.rows.length) + ').');
  }

  root.addEventListener('change', (e) => {
    if (e.target && e.target.matches('input[type="checkbox"]')) sync();
  });
  root.addEventListener('click', (e) => {
    const selectAll = e.target.closest('[data-spreadsheet-select]');
    if (selectAll) {
      const on = selectAll.dataset.spreadsheetSelect === 'all';
      boxes.forEach(box => { box.checked = on; });
      sync();
      return;
    }
    if (e.target.closest('#spreadsheetCopy')) copySelection();
    else if (e.target.closest('#spreadsheetCsv')) downloadCsv();
  });

  sync();
})();
