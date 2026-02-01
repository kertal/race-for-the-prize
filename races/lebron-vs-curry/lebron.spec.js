// 🏀 LeBron James - The King
// Four-time NBA Champion. Unstoppable force.
// Race: Scroll to the bottom of his Wikipedia page — dribbling style.

await page.goto('https://en.wikipedia.org/wiki/LeBron_James', { waitUntil: 'domcontentloaded' });

await page.raceRecordingStart();
await page.waitForTimeout(1500);
await page.raceStart('Scroll to Bottom');

// Basketball dribble scrolling: bounce down, then back up, net progress downward
while (true) {
  // Dribble down (the hard bounce)
  const downStep = 250 + Math.floor(Math.random() * 100); // 250–350px down
  await page.mouse.wheel(0, downStep);
  await page.waitForTimeout(40 + Math.floor(Math.random() * 20));

  // Bounce back up (the rebound)
  const upStep = 80 + Math.floor(Math.random() * 60); // 80–140px back up
  await page.mouse.wheel(0, -upStep);
  await page.waitForTimeout(40 + Math.floor(Math.random() * 20));

  const atBottom = await page.evaluate(
    () => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight
  );
  if (atBottom) break;
}

page.raceEnd('Scroll to Bottom');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
