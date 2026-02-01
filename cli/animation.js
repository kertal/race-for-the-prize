/**
 * Terminal racing animation for the CLI race tool.
 * Shows two racing cars advancing across the terminal while the race runs.
 */

const TRACK_WIDTH = 50;
const TRACK_CHAR = '·';
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MAX_SPEED_INCREMENT = 1.5;
const MIN_SPEED_INCREMENT = 0.3;

import { c } from './colors.js';

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
    this.names = names; // [racer1, racer2]
    this.info = info || null;
    this.pos = [0, 0];
    this.finished = [false, false];
    this.finishOrder = [];
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
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const colors = [c.red, c.blue];

    for (let i = 0; i < 2; i++) {
      if (!this.finished[i]) {
        this.pos[i] = Math.min(this.pos[i] + Math.random() * MAX_SPEED_INCREMENT + MIN_SPEED_INCREMENT, TRACK_WIDTH);
      }
    }

    if (this.lines > 0) {
      process.stderr.write(`\x1b[${this.lines}A`);
    }

    const tracks = [0, 1].map(i => {
      const p = Math.floor(this.pos[i]);
      const behind = TRACK_CHAR.repeat(p);
      const ahead = TRACK_CHAR.repeat(Math.max(0, TRACK_WIDTH - p));
      const car = this.finished[i] ? '🏁' : '🏎️  💨';
      let status;
      if (this.finished[i]) {
        const place = this.finishOrder.indexOf(i);
        const medal = place === 0 ? '🥇' : '🥈';
        status = medal;
      } else {
        status = `${c.dim}…${c.reset}`;
      }
      return `  ${colors[i]}${c.bold}${this.names[i].padEnd(10)}${c.reset} ${c.dim}${behind}${c.reset}${car}${c.dim}${ahead}${c.reset} ${status}`;
    });

    const output = [
      `  ${c.cyan}${SPINNER[this.frameIdx]}${c.reset} ${c.dim}Elapsed: ${elapsed}s${c.reset}`,
      ``,
      tracks[0],
      tracks[1],
      ``,
    ];

    this.lines = output.length;
    process.stderr.write(output.map(l => l + '\x1b[K').join('\n') + '\n');
  }

  racerFinished(index) {
    if (!this.finished[index]) {
      this.finished[index] = true;
      this.finishOrder.push(index);
    }
    this.pos[index] = TRACK_WIDTH;
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.pos = [TRACK_WIDTH, TRACK_WIDTH];
    this.finished = [true, true];
    this._tick();
    process.stderr.write(c.showCursor);
    process.stderr.write('\n');
  }
}
