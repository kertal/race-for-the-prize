import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';
import { buildPlayerHtml } from './cli/videoplayer.js';

const dir = path.resolve('races/lauda-vs-hunt/results-2026-09-01_22-15-50-0b56e0/4g');
const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf-8'));

const clipTimes = summary.racers.map(() => ({
  start: 0.5, end: 2.5, recordingOffset: 0.1, wallClockDuration: 3,
  _wcStart: 0.5, _wcEnd: 2.5,
  measurements: [{ name: 'Load', startTime: 0.6, endTime: 2.0 }],
}));
const html = buildPlayerHtml(summary, summary.racers.map(r => `${r}/${r}.race.webm`), null, null, { clipTimes });
fs.writeFileSync(path.join(dir, 'smoke.html'), html);

const types = { '.html': 'text/html', '.webm': 'video/webm', '.json': 'application/json', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(dir) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(`http://127.0.0.1:${port}/smoke.html`, { waitUntil: 'load' });
await page.waitForTimeout(2000);

const result = await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const seg = document.getElementById('segmentNav');
  const out = { segOptions: seg ? Array.from(seg.options).map(o => o.value) : null, steps: [] };
  out.durations = Array.from(document.querySelectorAll('video')).map(v => Number.isFinite(v.duration) ? +v.duration.toFixed(2) : 'inf');
  if (seg) {
    for (const v of ['__full__', 'Load', '__all__']) {
      if (Array.from(seg.options).some(o => o.value === v)) {
        seg.value = v; seg.dispatchEvent(new Event('change')); await wait(400);
        out.steps.push(v + ' -> t=' + document.querySelector('video').currentTime.toFixed(2));
      }
    }
  }
  document.getElementById('playBtn')?.click(); await wait(400);
  out.playBtn = document.getElementById('playBtn')?.textContent;
  document.getElementById('nextFrame')?.click(); await wait(100);
  document.getElementById('goEnd')?.click(); await wait(100);
  document.getElementById('goStart')?.click(); await wait(100);
  return out;
});

await browser.close();
server.close();
fs.rmSync(path.join(dir, 'smoke.html'), { force: true });

console.log('durations:', JSON.stringify(result.durations));
console.log('segOptions:', JSON.stringify(result.segOptions));
console.log('segment switches:', JSON.stringify(result.steps));
console.log('playBtn label after play:', JSON.stringify(result.playBtn));
console.log('errors count:', errors.length);
for (const e of errors) console.log('  ' + e);
process.exit(errors.length ? 1 : 0);
