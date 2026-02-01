// 🏆 James Hunt - The Shunt
// 1976 World Champion. Raw speed, pure guts.
// Race: Scroll to the bottom of his Wikipedia page — human-like speed.

await page.goto('https://en.wikipedia.org/wiki/James_Hunt', { waitUntil: 'domcontentloaded' });

await page.raceRecordingStart();
await page.waitForTimeout(1500);
await page.raceStart('Scroll to Bottom');

// Human-like scrolling: small steps with slight randomness
while (true) {
  const step = 120 + Math.floor(Math.random() * 80); // 120–200px per tick
  await page.mouse.wheel(0, step);
  await page.waitForTimeout(30 + Math.floor(Math.random() * 30)); // 30–60ms pause

  const atBottom = await page.evaluate(
    () => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight
  );
  if (atBottom) break;
}

page.raceEnd('Scroll to Bottom');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
