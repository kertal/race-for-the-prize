/**
 * Terminal racing animation and progress spinners.
 */

import { c, RACER_COLORS } from './colors.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function startProgress(msg) {
  let idx = 0;
  const write = () => {
    process.stderr.write(`\r  ${c.cyan}${SPINNER[idx]}${c.reset} ${c.dim}${msg}${c.reset}\x1b[K`);
    idx = (idx + 1) % SPINNER.length;
  };
  write();
  const interval = setInterval(write, 100);
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
    this.messages = [];
    this.interval = null;
    this.frameIdx = 0;
    this.startTime = Date.now();
    this.lines = 0;
  }

  start() {
    process.stderr.write(c.hideCursor);
    // Build dynamic header with all racer names
    const coloredNames = this.names.map((name, i) => {
      const color = RACER_COLORS[i % RACER_COLORS.length];
      return `${color}${c.bold}${name}${c.reset}`;
    });
    const vsString = coloredNames.join(` ${c.dim}vs${c.reset} `);
    let header = `\n  ${c.bold}RaceForThePrize${c.reset} 🏆  ${vsString}`;
    if (this.info) header += `\n  ${c.dim}${this.info}${c.reset}`;
    process.stderr.write(header + '\n\n');
    this.interval = setInterval(() => this._tick(), 120);
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

    for (const msg of this.messages) {
      const nameColor = RACER_COLORS[msg.index % RACER_COLORS.length];
      process.stderr.write(`  ${nameColor}${c.bold}${msg.name}:${c.reset} ${c.dim}"${msg.text}" (${msg.elapsed}s)${c.reset}\x1b[K\n`);
      this.lines++;
    }
  }

  racerFinished(index) {
    this.finished[index] = true;
  }

  addMessage(index, name, text, elapsed) {
    this.messages.push({ index, name, text, elapsed });
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.finished = this.finished.map(() => true);
    process.stderr.write(c.showCursor);
    process.stderr.write(`  ${c.dim}Calculating results…${c.reset}\n`);
  }
}
