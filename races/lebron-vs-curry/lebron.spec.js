// 🏀 LeBron James - The King
// Four-time NBA Champion. Unstoppable force.
// Race: Dribble 3 times at the bottom (800px bounce), then scroll to the top.

await page.goto('https://en.wikipedia.org/wiki/LeBron_James', { waitUntil: 'domcontentloaded' });

// Scroll to a fixed absolute position (same for both racers so dribbles stay in sync)
const fixedStart = 10000;
await page.evaluate((y) => window.scrollTo(0, y), fixedStart);

await page.raceRecordingStart();
await page.waitForTimeout(3000);
await page.raceStart('Dribble Race');

// Basketball physics dribble — identical timing for both racers to stay in sync
for (let i = 0; i < 3; i++) {
  const downDist = 800;
  const downSteps = 25;
  for (let s = 0; s < downSteps; s++) {
    const t = (s + 1) / downSteps;
    const stepPx = Math.round((downDist * (2 * t)) / downSteps);
    await page.mouse.wheel(0, Math.max(stepPx, 2));
    await page.waitForTimeout(Math.round(35 - 22 * t));
  }

  await page.waitForTimeout(60);

  const upDist = 800;
  const upSteps = 25;
  for (let s = 0; s < upSteps; s++) {
    const t = (s + 1) / upSteps;
    const stepPx = Math.round((upDist * (2 * (1 - t))) / upSteps);
    await page.mouse.wheel(0, -Math.max(stepPx, 2));
    await page.waitForTimeout(Math.round(13 + 22 * t));
  }

  await page.waitForTimeout(140);
}

// Scroll to top — LeBron powers up with a strong smooth scroll
const scrollSteps = 40;
const totalScroll = await page.evaluate(() => window.scrollY);
for (let s = 0; s < scrollSteps; s++) {
  const t = (s + 1) / scrollSteps;
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const targetY = Math.round(totalScroll * (1 - ease));
  await page.evaluate((y) => window.scrollTo(0, y), targetY);
  await page.waitForTimeout(18);
}
await page.evaluate(() => window.scrollTo(0, 0));

page.raceEnd('Dribble Race');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
