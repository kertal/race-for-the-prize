// 🧡 Svelte - The Compiler Champion
// Created by Rich Harris in 2016. Compiles away the framework.
// Race: Load the official Svelte documentation and measure time to interactive.

await page.raceRecordingStart();
await page.waitForTimeout(500);
await page.raceStart('Load Framework');

await page.goto('https://svelte.dev/', { waitUntil: 'domcontentloaded' });

// Wait for the main hero content to be visible
await page.waitForSelector('h1', { state: 'visible' });

page.raceEnd('Load Framework');
page.raceMessage('Compiled and ready!');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
