// 📊 Grafana 11.4.0  — February 2026
// Login and load the eCommerce dashboard.
// Requires: docker compose up -d && bash docker/init.sh

const BASE_URL = 'http://localhost:3002';
const DASHBOARD_URL = `${BASE_URL}/d/race-ecommerce`;

// All visible panels have finished loading — the loading-bar-container div is
// populated with an animated child while a panel is fetching data, and goes
// empty once data has arrived and the visualization has rendered.
const allPanelsRendered = () => {
  const containers = document.querySelectorAll('[class*="loading-bar-container"]');
  return containers.length > 0 && ![...containers].some(c => c.children.length > 0);
};

// Login
await page.goto(`${BASE_URL}/login`);
await page.waitForSelector('input[name="user"]', { timeout: 30000 });
await page.fill('input[name="user"]', 'admin');
await page.fill('input[name="password"]', 'admin');
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
await page.goto(`${BASE_URL}/dashboards`, { waitUntil: 'domcontentloaded', timeout: 30000 });
// Programmatic click — not tracked by the mousedown-based click counter.
await page.waitForSelector('a[href*="/d/race-ecommerce"]', { timeout: 30000 });
await Promise.all([
  page.waitForLoadState('domcontentloaded'),
  page.evaluate(() => {
    const link =
      document.querySelector('a[href*="/d/race-ecommerce"]') ||
      [...document.querySelectorAll('a')].find(a => a.textContent.trim().toLowerCase().includes('ecommerce'));
    if (!link) throw new Error('eCommerce dashboard link not found');
    link.click();
  }),
]);
await page.waitForFunction(allPanelsRendered, { timeout: 60000 });
await page.waitForTimeout(3000);

// Navigate back to the dashboard list via the breadcrumb link (no goto — natural navigation).
await Promise.all([
  page.waitForLoadState('domcontentloaded'),
  page.evaluate(() => {
    const link = document.querySelector('a[href="/dashboards"]') ||
      [...document.querySelectorAll('nav a')].find(a => a.textContent.trim() === 'Dashboards');
    if (!link) throw new Error('Dashboards breadcrumb not found');
    link.click();
  }),
]);
await page.waitForSelector('a[href*="/d/race-ecommerce"]', { timeout: 30000 });
await page.waitForTimeout(1000);
// ── Race: click the dashboard from the list and measure time until all panels render ─
await page.raceRecordingStart();
await page.waitForTimeout(2000);
await page.raceStart('Dashboard Load');

// Re-wait in case Grafana's virtual list re-rendered during the recording setup delay.
await page.waitForSelector('a[href*="/d/race-ecommerce"]', { timeout: 10000 });

// Programmatic click — not tracked by the mousedown-based click counter.
await Promise.all([
  page.waitForLoadState('domcontentloaded'),
  page.evaluate(() => {
    const link =
      document.querySelector('a[href*="/d/race-ecommerce"]') ||
      [...document.querySelectorAll('a')].find(a => a.textContent.trim().toLowerCase().includes('ecommerce'));
    if (!link) throw new Error('eCommerce dashboard link not found');
    link.click();
  }),
]);
await page.waitForFunction(allPanelsRendered, { timeout: 60000 });

page.raceEnd('Dashboard Load');
page.raceMessage('Grafana 11.4 (Feb 2026)');
await page.waitForTimeout(2000);
await page.raceRecordingEnd();
