import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyThrottling, throttles, NETWORK_PRESETS } = require('../runner-throttling.cjs');

/** A page whose CDP sessions record what was sent on them, plus every attach. */
function makePage(calls) {
  return {
    context() {
      return {
        newCDPSession: async () => {
          calls.push(['attach']);
          return { async send(method, params) { calls.push([method, params]); return {}; } };
        },
      };
    },
  };
}

describe('throttles', () => {
  it('is false for no throttle and for the default that asks for nothing', () => {
    expect(throttles(null)).toBe(false);
    expect(throttles(undefined)).toBe(false);
    expect(throttles({ network: 'none', cpu: 1 })).toBe(false);
    expect(throttles({ network: 'unknown-preset', cpu: 1 })).toBe(false);
  });

  it('is true for a network preset, a CPU slowdown, or both', () => {
    expect(throttles({ network: 'slow-3g', cpu: 1 })).toBe(true);
    expect(throttles({ network: 'none', cpu: 4 })).toBe(true);
    expect(throttles({ network: '4g', cpu: 2 })).toBe(true);
  });
});

describe('applyThrottling', () => {
  it('attaches no session when there is nothing to send on it', async () => {
    // The session it attaches is kept alive for the rest of the race, so the
    // default throttle — which every race carries — must not cost one.
    for (const throttle of [null, { network: 'none', cpu: 1 }]) {
      const calls = [];
      await applyThrottling(makePage(calls), throttle, 'r');
      expect(calls).toEqual([]);
    }
  });

  it('sets the CPU rate on one session of its own', async () => {
    const calls = [];
    await applyThrottling(makePage(calls), { network: 'none', cpu: 4 }, 'r');
    expect(calls).toEqual([['attach'], ['Emulation.setCPUThrottlingRate', { rate: 4 }]]);
  });

  it('emulates the network preset, and the CPU rate when both are asked for', async () => {
    const calls = [];
    await applyThrottling(makePage(calls), { network: 'slow-3g', cpu: 2 }, 'r');
    expect(calls).toEqual([
      ['attach'],
      ['Network.enable', undefined],
      ['Network.emulateNetworkConditions', { offline: false, ...NETWORK_PRESETS['slow-3g'] }],
      ['Emulation.setCPUThrottlingRate', { rate: 2 }],
    ]);
  });

  it('warns rather than throws when the browser refuses', async () => {
    const page = { context() { return { newCDPSession: async () => { throw new Error('nope'); } }; } };
    const warnings = [];
    const original = console.error;
    console.error = (msg) => warnings.push(msg);
    try {
      await expect(applyThrottling(page, { network: 'none', cpu: 4 }, 'r')).resolves.toBeUndefined();
    } finally {
      console.error = original;
    }
    expect(warnings).toEqual(['[r] Warning: throttling failed: nope']);
  });
});
