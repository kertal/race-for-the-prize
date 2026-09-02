/**
 * runner-throttling.cjs — network & CPU throttling via CDP.
 */

const NETWORK_PRESETS = {
  'none': null,
  'slow-3g': { downloadThroughput: 500 * 1024 / 8, uploadThroughput: 500 * 1024 / 8, latency: 400 },
  'fast-3g': { downloadThroughput: 1500 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 150 },
  '4g': { downloadThroughput: 4000 * 1024 / 8, uploadThroughput: 3000 * 1024 / 8, latency: 50 },
};

async function applyThrottling(page, throttle, id) {
  if (!throttle) return;
  try {
    // CDP session intentionally kept alive — detaching removes throttling.
    // Session is cleaned up when the browser context closes.
    const client = await page.context().newCDPSession(page);
    const net = NETWORK_PRESETS[throttle.network];
    if (net) {
      await client.send('Network.enable');
      await client.send('Network.emulateNetworkConditions', { offline: false, ...net });
    }
    if (throttle.cpu > 1) {
      await client.send('Emulation.setCPUThrottlingRate', { rate: throttle.cpu });
    }
  } catch (error) {
    console.error(`[${id}] Warning: throttling failed: ${error.message}`);
  }
}

module.exports = { NETWORK_PRESETS, applyThrottling };
