// 🏀 Stephen Curry - The Chef
// Four-time NBA Champion. Greatest shooter of all time.
// Race: Scroll to the bottom of his Wikipedia page — dribbling style.

await page.goto('https://en.wikipedia.org/wiki/Stephen_Curry', { waitUntil: 'domcontentloaded' });

await page.raceRecordingStart();
await page.waitForTimeout(1500);
await page.raceStart('Scroll to Bottom');

// Basketball dribble scrolling: quick crossover-style bounces, faster tempo
while (true) {
  // Dribble down (quick push)
  const downStep = 200 + Math.floor(Math.random() * 80); // 200–280px down
  await page.mouse.wheel(0, downStep);
  await page.waitForTimeout(30 + Math.floor(Math.random() * 15));

  // Bounce back up (snappy handle)
  const upStep = 60 + Math.floor(Math.random() * 50); // 60–110px back up
  await page.mouse.wheel(0, -upStep);
  await page.waitForTimeout(30 + Math.floor(Math.random() * 15));

  const atBottom = await page.evaluate(
    () => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight
  );
  if (atBottom) break;
}

page.raceEnd('Scroll to Bottom');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
