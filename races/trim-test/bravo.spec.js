// Bravo — Recording delay: 200ms, Race duration: ~800ms
// The timer on screen shows elapsed ms since page load, making it easy
// to verify that the trimmed video starts/ends at the right timestamps.

const COLOR = '#3498db';
const LABEL = 'BRAVO';

await page.setContent(`<!DOCTYPE html>
<html><head><style>
  * { margin: 0; }
  body { background: #111; color: #fff; font-family: monospace;
         display: flex; flex-direction: column; align-items: center;
         justify-content: center; height: 100vh; }
  #clock { font-size: 8vw; color: ${COLOR}; }
  #label { font-size: 3vw; color: ${COLOR}; opacity: 0.6; margin-bottom: 1rem; }
  #bar   { width: 80%; height: 40px; background: #222; border-radius: 8px;
           overflow: hidden; margin-top: 2rem; }
  #fill  { height: 100%; width: 0%; background: ${COLOR}; transition: none; }
  #phase { font-size: 1.5vw; color: #666; margin-top: 1rem; }
</style></head><body>
  <div id="label">${LABEL}</div>
  <div id="clock">0</div>
  <div id="bar"><div id="fill"></div></div>
  <div id="phase">waiting</div>
  <script>
    const t0 = performance.now();
    const clock = document.getElementById('clock');
    const fill  = document.getElementById('fill');
    const phase = document.getElementById('phase');
    function tick() {
      const ms = Math.round(performance.now() - t0);
      clock.textContent = ms;
      requestAnimationFrame(tick);
    }
    tick();
    window.__setPhase = (name, durationMs) => {
      phase.textContent = name;
      if (durationMs) {
        fill.style.transition = 'width ' + durationMs + 'ms linear';
        fill.style.width = '100%';
      }
    };
  </script>
</body></html>`);

// Let the page settle and clock start ticking
await page.waitForTimeout(200);

// --- Staggered recording start: 200ms delay ---
await page.waitForTimeout(200);
await page.raceRecordingStart();
await page.evaluate(() => window.__setPhase('recording'));

// Padding before measurement
await page.waitForTimeout(300);

// --- Race measurement: ~800ms ---
await page.raceStart('Render');
await page.evaluate(() => window.__setPhase('racing', 800));
await page.waitForTimeout(800);
page.raceEnd('Render');

// Padding after measurement
await page.evaluate(() => window.__setPhase('done'));
await page.waitForTimeout(300);
await page.raceRecordingEnd();
