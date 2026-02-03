/**
 * Terminal racing animation and progress spinners.
 */

import { c } from './colors.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Show a spinner with a message. Returns { update(msg), done(msg) }.
 */
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
    this.finished = [false, false];
    this.messages = [];
    this.interval = null;
    this.frameIdx = 0;
    this.startTime = Date.now();
    this.lines = 0;
  }

  start() {
    process.stderr.write(c.hideCursor);
    let header = `\n  ${c.bold}RaceForThePrize${c.reset} 🏆  ${c.red}${c.bold}${this.names[0]}${c.reset} ${c.dim}vs${c.reset} ${c.blue}${c.bold}${this.names[1]}${c.reset}`;
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
      const nameColor = msg.index === 0 ? c.red : c.blue;
      process.stderr.write(`  ${nameColor}${c.bold}${msg.name}:${c.reset} ${c.dim}"${msg.text}" (${msg.elapsed}s)${c.reset}\x1b[K\n`);
      this.lines++;
    }
  }

  racerFinished(index) {
    this.finished[index] = true;
  }

  addMessage(index, name, text) {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.messages.push({ index, name, text, elapsed });
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.finished = [true, true];
    if (this.lines > 0) {
      process.stderr.write(`\x1b[${this.lines}A`);
      for (let i = 0; i < this.lines; i++) process.stderr.write('\x1b[K\n');
      process.stderr.write(`\x1b[${this.lines}A`);
    }
    process.stderr.write(c.showCursor);
    process.stderr.write(`  ${c.dim}Calculating results…${c.reset}\n`);
  }
}
