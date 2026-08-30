#!/usr/bin/env node
/**
 * Build a static GitHub Pages site from race results.
 *
 * Scans races/<race>/results-* directories, copies the most recent results
 * of each race into the output directory, and generates an index.html that
 * lists all races with links to their HTML race players.
 *
 * Usage:
 *   node scripts/build-pages.js [--out=site] [--races=races] [--base-title="Race for the Prize"]
 *
 * Run races first (headless, no server, no wasm copy keeps output small):
 *   node race.js ./races/<race> --headless --serve=0 --wasm=0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const RACER_CSS_COLORS = ['#e74c3c', '#3498db', '#27ae60', '#f1c40f', '#9b59b6'];

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseArgs(argv) {
  const args = { out: 'site', races: 'races', title: 'Race for the Prize' };
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'out') args.out = m[2];
    if (m[1] === 'races') args.races = m[2];
    if (m[1] === 'base-title') args.title = m[2];
  }
  return args;
}

/** Latest results dir of a race, or null. Names are timestamped so they sort lexically. */
function latestResultsDir(raceDir) {
  let entries;
  try {
    entries = fs.readdirSync(raceDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const results = entries
    .filter(e => e.isDirectory() && e.name.startsWith('results-'))
    .map(e => e.name)
    .sort()
    .reverse();
  return results.length ? path.join(raceDir, results[0]) : null;
}

/** Read the summary for a results dir, handling single- and multi-run layouts. */
function readRaceInfo(resultsDir) {
  const topSummary = path.join(resultsDir, 'summary.json');
  const topIndex = path.join(resultsDir, 'index.html');
  const runOneSummary = path.join(resultsDir, '1', 'summary.json');
  const runOneIndex = path.join(resultsDir, '1', 'index.html');

  let summaryPath = null;
  let indexRel = null;
  if (fs.existsSync(topIndex)) indexRel = 'index.html';
  else if (fs.existsSync(runOneIndex)) indexRel = '1/index.html';

  if (fs.existsSync(topSummary)) summaryPath = topSummary;
  else if (fs.existsSync(runOneSummary)) summaryPath = runOneSummary;

  if (!indexRel || !summaryPath) return null;

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  } catch {
    return null;
  }

  const runs = fs.readdirSync(resultsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d+$/.test(e.name)).length;

  return { summary, indexRel, runs: runs || 1 };
}

/** Copy a results dir, skipping runner temp dirs. */
function copyResults(src, dest) {
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (source) => !path.basename(source).startsWith('tmp-'),
  });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function buildRaceCard(race) {
  const { name, summary, indexRel, runs } = race;
  const racers = summary.racers || [];
  const winner = summary.overallWinner || null;
  const wins = summary.wins || {};
  const href = `${encodeURIComponent(name)}/${indexRel}`;

  const chips = racers.map((racer, i) => {
    const color = RACER_CSS_COLORS[i % RACER_CSS_COLORS.length];
    const trophy = racer === winner ? ' 🏆' : '';
    const winCount = wins[racer] !== undefined ? ` <span class="chip-wins">${wins[racer]}</span>` : '';
    return `<span class="racer-chip" style="border-color:${color};color:${color}">${escHtml(racer)}${trophy}${winCount}</span>`;
  }).join('\n        ');

  const verdict = winner
    ? `🏆 <strong>${escHtml(winner)}</strong> wins`
    : 'Photo finish — no overall winner';
  const runsLabel = runs > 1 ? ` · ${runs} runs` : '';

  return `    <a class="race-card" href="${href}">
      <div class="race-card-head">
        <span class="race-name">${escHtml(name)}</span>
        <span class="race-date">${escHtml(formatDate(summary.timestamp))}${runsLabel}</span>
      </div>
      <div class="race-chips">
        ${chips}
      </div>
      <div class="race-verdict">${verdict}</div>
      <div class="race-watch">Watch the race ▶</div>
    </a>`;
}

function buildIndexHtml(title, races, generatedAt) {
  const cards = races.map(buildRaceCard).join('\n');
  const empty = `    <p class="empty">No race results yet. Run a race and rebuild the site.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)} — Test Races</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a1a;
    color: #e8e0d0;
    font-family: ui-monospace, 'Courier New', monospace;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .checkered-bar {
    width: 100%;
    height: 20px;
    background: repeating-conic-gradient(#222 0% 25%, #d4af37 0% 50%) 0 0 / 20px 20px;
  }
  header { text-align: center; padding: 2rem 1rem 0.5rem; }
  h1 {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.8rem;
    color: #d4af37;
    text-transform: uppercase;
    letter-spacing: 0.15em;
  }
  .subtitle { color: #999; font-size: 0.85rem; margin-top: 0.5rem; }
  main { width: 100%; max-width: 760px; padding: 1.5rem 1rem 3rem; display: flex; flex-direction: column; gap: 1rem; }
  .race-card {
    display: block;
    background: #242424;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 1rem 1.2rem;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.2s, background 0.2s;
  }
  .race-card:hover { border-color: #d4af37; background: #2a2a2a; }
  .race-card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  .race-name {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.15rem;
    color: #d4af37;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .race-date { color: #777; font-size: 0.75rem; }
  .race-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.7rem; }
  .racer-chip {
    border: 1px solid;
    border-radius: 999px;
    padding: 0.15rem 0.7rem;
    font-size: 0.8rem;
    font-weight: bold;
  }
  .chip-wins { color: #999; font-weight: normal; }
  .race-verdict { margin-top: 0.7rem; font-size: 0.85rem; color: #ccc; }
  .race-verdict strong { color: #d4af37; }
  .race-watch { margin-top: 0.5rem; font-size: 0.8rem; color: #d4af37; }
  .empty { color: #999; text-align: center; padding: 2rem 0; }
  footer { margin-top: auto; width: 100%; text-align: center; color: #666; font-size: 0.75rem; padding: 1rem; }
  footer a { color: #d4af37; }
</style>
</head>
<body>
<div class="checkered-bar"></div>
<header>
  <h1>🏆 ${escHtml(title)}</h1>
  <p class="subtitle">Test races — pick a race to watch the head-to-head result</p>
</header>
<main>
${races.length ? cards : empty}
</main>
<footer>
  Generated ${escHtml(generatedAt)} ·
  <a href="https://github.com/kertal/race-for-the-prize">race-for-the-prize</a>
</footer>
<div class="checkered-bar"></div>
</body>
</html>
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const racesRoot = path.resolve(rootDir, args.races);
  const outDir = path.resolve(rootDir, args.out);

  if (!fs.existsSync(racesRoot)) {
    console.error(`Races directory not found: ${racesRoot}`);
    process.exit(1);
  }

  const raceDirs = fs.readdirSync(racesRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const races = [];
  for (const name of raceDirs) {
    const resultsDir = latestResultsDir(path.join(racesRoot, name));
    if (!resultsDir) {
      console.log(`  ⏭  ${name}: no results, skipping`);
      continue;
    }
    const info = readRaceInfo(resultsDir);
    if (!info) {
      console.log(`  ⏭  ${name}: results incomplete (missing index.html or summary.json), skipping`);
      continue;
    }
    copyResults(resultsDir, path.join(outDir, name));
    races.push({ name, ...info });
    console.log(`  ✔  ${name}: ${path.basename(resultsDir)} → ${args.out}/${name}/`);
  }

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  fs.writeFileSync(path.join(outDir, 'index.html'), buildIndexHtml(args.title, races, generatedAt));
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

  console.log(`\n🏁 Site built: ${races.length} race(s) → ${outDir}`);
  if (!races.length) {
    console.log('   No races had results. Run e.g.: node race.js ./races/lauda-vs-hunt --headless --serve=0 --wasm=0');
  }
}

main();
