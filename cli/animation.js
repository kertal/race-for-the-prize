/**
 * Terminal racing animation and progress spinners.
 */

import { c, RACER_COLORS } from './colors.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 100;
const TICK_INTERVAL_MS = 120;
const FALLBACK_WIDTH = 100;
/**
 * Shorten `text` so a line built as prefix + text + suffix stays inside the
 * terminal width. The animation redraws by moving the cursor up one row per
 * line it wrote, so a single line that wraps onto two rows leaves the previous
 * frame stranded on screen — the redraw rewinds one row short every tick.
 * Racer messages come from race scripts and can be arbitrarily long, so they
 * are the ones that need clamping.
 *
 * The result never exceeds the room left over, down to an empty string: a
 * minimum length would be self-defeating here, since overflowing by a
 * character causes exactly the wrap this exists to prevent.
 *
 * @param {string} text
 * @param {number} chromeWidth - visible width of everything around the text
 * @param {number} width - terminal width in columns
 * @returns {string} text of at most `width - 1 - chromeWidth` columns
 */
export function fitMessageText(text, chromeWidth, width) {
  // One column spare: writing into the last one wraps in some terminals.
  const room = width - 1 - chromeWidth;
  if (room <= 0) return '';
  if (text.length <= room) return text;
  return room === 1 ? '…' : text.slice(0, room - 1) + '…';
}

const isTTY = () => Boolean(process.stderr.isTTY);

export function startProgress(msg) {
  let idx = 0;
  if (!isTTY()) {
    // Non-TTY: print once, skip spinner animation and cursor escapes.
    process.stderr.write(`  ${msg}\n`);
    return {
      update(newMsg) { msg = newMsg; },
      done(doneMsg) { process.stderr.write(`  ✓ ${doneMsg || msg}\n`); },
      fail(failMsg) { process.stderr.write(`  ${failMsg || msg}\n`); },
    };
  }
  const write = () => {
    process.stderr.write(`\r  ${c.cyan}${SPINNER[idx]}${c.reset} ${c.dim}${msg}${c.reset}\x1b[K`);
    idx = (idx + 1) % SPINNER.length;
  };
  write();
  const interval = setInterval(write, SPINNER_INTERVAL_MS);
  return {
    update(newMsg) { msg = newMsg; },
    done(doneMsg) {
      clearInterval(interval);
      process.stderr.write(`\r  ${c.green}${c.bold}✓${c.reset} ${c.dim}${doneMsg || msg}${c.reset}\x1b[K\n`);
    },
    fail(failMsg) {
      clearInterval(interval);
      process.stderr.write(`\r  ${c.dim}${failMsg || msg}${c.reset}\x1b[K\n`);
    },
  };
}

export class RaceAnimation {
  constructor(names, info) {
    this.names = names;
    this.info = info || null;
    this.finished = new Array(names.length).fill(false);
    this.messages = new Array(names.length).fill(null);
    this.interval = null;
    this.frameIdx = 0;
    this.startTime = Date.now();
    this.lines = 0;
  }

  start() {
    this.tty = isTTY();
    if (this.tty) {
      process.stderr.write(c.hideCursor);
      const coloredNames = this.names.map((name, i) => {
        const color = RACER_COLORS[i % RACER_COLORS.length];
        return `${color}${c.bold}${name}${c.reset}`;
      });
      const vsString = coloredNames.join(` ${c.dim}vs${c.reset} `);
      let header = `\n  ${c.bold}RaceForThePrize${c.reset} 🏆  ${vsString}`;
      if (this.info) header += `\n  ${c.dim}${this.info}${c.reset}`;
      process.stderr.write(header + '\n\n');
      this.interval = setInterval(() => this._tick(), TICK_INTERVAL_MS);
    } else {
      // Plain-text header — no ANSI escapes, safe for piped output / CI logs.
      let header = `\n  RaceForThePrize 🏆  ${this.names.join(' vs ')}`;
      if (this.info) header += `\n  ${this.info}`;
      process.stderr.write(header + '\n\n');
    }
  }

  _tick() {
    this.frameIdx = (this.frameIdx + 1) % SPINNER.length;
    const ms = Date.now() - this.startTime;
    const elapsed = (ms / 1000).toFixed(1);
    const allDone = this.finished.every(Boolean);
    const emoji = allDone ? '🏁' : ms < 1000 ? '🔫' : '🏎️';

    if (this.lines > 0) process.stderr.write(`\x1b[${this.lines}A`);

    const line = `  ${c.cyan}${SPINNER[this.frameIdx]}${c.reset} ${c.dim}Elapsed: ${elapsed}s${c.reset}  ${emoji}`;
    this.lines = 1;
    process.stderr.write(line + '\x1b[K\n');

    const width = process.stderr.columns || FALLBACK_WIDTH;
    for (const msg of this.messages) {
      if (!msg) continue;
      const nameColor = RACER_COLORS[msg.index % RACER_COLORS.length];
      // Width of the punctuation around name and text, colors excluded — they
      // cost no columns. The name is clamped first: one long enough to fill the
      // row on its own would blow the budget before the message even starts.
      const decoration = `  : "" (${msg.elapsed}s)`.length;
      const name = fitMessageText(msg.name, decoration, width);
      const text = fitMessageText(msg.text, decoration + name.length, width);
      process.stderr.write(`  ${nameColor}${c.bold}${name}:${c.reset} ${c.dim}"${text}" (${msg.elapsed}s)${c.reset}\x1b[K\n`);
      this.lines++;
    }
  }

  racerFinished(index) {
    this.finished[index] = true;
    this.messages[index] = null;
  }

  addMessage(index, name, text, elapsed) {
    const prev = this.messages[index];
    if (prev && prev.text === text && prev.elapsed === elapsed) return;
    this.messages[index] = { index, name, text, elapsed };
    // Non-TTY fallback: emit a plain-text line (no ANSI) since the tick loop is disabled.
    if (!this.tty) {
      process.stderr.write(`  ${name}: "${text}" (${elapsed}s)\n`);
    }
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.finished = this.finished.map(() => true);
    if (this.tty) {
      process.stderr.write(c.showCursor);
      process.stderr.write(`  ${c.dim}Calculating results…${c.reset}\n`);
    } else {
      process.stderr.write(`  Calculating results…\n`);
    }
  }
}
