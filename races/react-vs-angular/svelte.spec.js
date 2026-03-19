// 🧡 Svelte - The Compiler Champion
// Created by Rich Harris in 2016. Compiles away the framework.
// Race: Load the official Svelte documentation and measure time to interactive.

await page.raceRecordingStart();
await page.waitForTimeout(500);
await page.raceStart('Webpage loaded and stable');

await page.goto('https://svelte.dev/', { waitUntil: 'load' });
await page.raceWaitForVisualStability();

page.raceEnd('Webpage loaded and stable');

page.raceMessage('Compiled and ready!');
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
