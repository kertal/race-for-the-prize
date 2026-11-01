import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { MAX_RACERS } from '../cli/config.js';

const require = createRequire(import.meta.url);
const { calculateWindowLayout } = require('../runner-layout.cjs');

const DIMS = { screen: { width: 1920, height: 1080 }, windowHeight: 900 };

function layoutFor(total) {
  return Array.from({ length: total }, (_, i) => calculateWindowLayout(i, total, DIMS));
}

describe('calculateWindowLayout', () => {
  it('puts 2 browsers side by side across the full screen', () => {
    expect(layoutFor(2)).toEqual([
      { x: 0, y: 0, width: 960, height: 900 },
      { x: 960, y: 0, width: 960, height: 900 },
    ]);
  });

  it('puts 3 browsers in a single row of thirds', () => {
    expect(layoutFor(3)).toEqual([
      { x: 0, y: 0, width: 640, height: 900 },
      { x: 640, y: 0, width: 640, height: 900 },
      { x: 1280, y: 0, width: 640, height: 900 },
    ]);
  });

  it('puts 4 browsers — the maximum grid — in a 2x2 arrangement', () => {
    expect(layoutFor(MAX_RACERS)).toEqual([
      { x: 0, y: 0, width: 960, height: 540 },
      { x: 960, y: 0, width: 960, height: 540 },
      { x: 0, y: 540, width: 960, height: 540 },
      { x: 960, y: 540, width: 960, height: 540 },
    ]);
  });

  it('keeps every window inside the screen for every allowed racer count', () => {
    for (let total = 2; total <= MAX_RACERS; total++) {
      for (const win of layoutFor(total)) {
        expect(win.x).toBeGreaterThanOrEqual(0);
        expect(win.x + win.width, `total=${total} overflows horizontally`).toBeLessThanOrEqual(DIMS.screen.width);
        expect(win.y).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
