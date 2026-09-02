/**
 * Generates a self-contained HTML file with a retro Grand Prix styled
 * video player for race results. Supports 2-5 racers.
 *
 * The HTML structure lives in player.html (a real HTML template).
 * The CSS lives in player.css (inlined into the exported HTML at build time).
 * Section builders live in player-sections.js.
 * The browser-side player runtime lives in player-runtime/ as concern-scoped
 * source files, concatenated below in dependency order into one IIFE scope.
 * This module wires everything together via {{placeholder}} replacement.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlacementOrder } from './summary.js';
import {
  RACER_CSS_COLORS,
  escHtml,
  render,
  setTemplates,
  buildRunNavHtml,
  buildRaceInfoHtml,
  buildMachineInfoHtml,
  buildErrorsHtml,
  buildResultsHtml,
  buildRunComparisonHtml,
  buildProfileSummaryHtml,
  buildProfileHtml,
  buildFilesHtml,
  buildDebugPanelHtml,
  buildPlayerSectionHtml,
} from './player-sections.js';
import calibration from './player-runtime/calibration.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAW_HTML = fs.readFileSync(path.join(__dirname, 'player.html'), 'utf-8');
const CSS = fs.readFileSync(path.join(__dirname, 'player.css'), 'utf-8');

// Browser-side player runtime, split into concern-scoped files that are
// concatenated in dependency order into the single IIFE scope emitted by
// buildPlayerScript (runtime semantics identical to the former single file).
// The .cjs files hold pure logic with a guarded module.exports, so Node can
// require() them for unit tests while the browser concatenation ignores it.
const RUNTIME_FILES = [
  'config.js',         // build-time config injection + DOM bootstrap
  'playback.js',       // shared state, seeking, metadata, modes, controls
  'calibration.cjs',   // pure clip-calibration math (Node-testable)
  'debug-panel.js',    // calibration/debug panel UI
  'segments.js',       // segment navigation + racer filter UI
  'main.js',           // startup: initial verified seek + metadata pass
  'export-layout.cjs', // pure side-by-side export layout math (Node-testable)
  'export-video.js',   // canvas side-by-side export + ffmpeg.wasm conversion
  'fullscreen.js',     // fullscreen mode
  'zip.cjs',           // pure CRC32/ZIP builder (Node-testable)
  'metrics-csv.cjs',   // pure metrics.csv builder (Node-testable)
  'export-zip.js',     // self-contained HTML/ZIP export flows + performance data export
];
const RUNTIME = RUNTIME_FILES
  .map(f => fs.readFileSync(path.join(__dirname, 'player-runtime', f), 'utf-8'))
  .join('\n');

// Extract build-time templates (build-*) from HTML and strip them from the main template
function extractBuildTemplates(html) {
  const templates = {};
  const cleaned = html.replace(/<template id="build-([^"]+)">([\s\S]*?)<\/template>\s*/g, (_, id, content) => {
    templates[id] = content.trim();
    return '';
  });
  return { mainTemplate: cleaned, templates };
}

const { mainTemplate: TEMPLATE, templates: BUILD_TEMPLATES } = extractBuildTemplates(RAW_HTML);
setTemplates(BUILD_TEMPLATES);

// ---------------------------------------------------------------------------
// Style & Script Builders — read from external files and inline at export
// ---------------------------------------------------------------------------

function buildStyles(layoutCss) {
  return '<style>\n' + CSS + '  ' + layoutCss + '\n</style>';
}

function buildPlayerScript() {
  return '<script>\n(function() {\n' + RUNTIME + '\n})();\n</script>';
}

// Serialize race config for embedding in a <script type="application/json"> block.
// Escapes '<' so a value can't break out of the </script> context.
function serializeRaceConfig(config) {
  return JSON.stringify(config).replaceAll('<', String.raw`\u003c`);
}

function playerMaxWidth(count) {
  if (count <= 2) return 680;
  return count === 3 ? 450 : 340;
}

function playerContainerMaxWidth(count) {
  return count <= 3 ? 1400 : 1440;
}

function trophyHtml(isWinner, isTie) {
  if (!isWinner) return '';
  return `<span class="trophy">${isTie ? '&#129309;' : '&#127942;'}</span> `;
}

// Build the player section, debug panel, runtime script tag, and race-config
// JSON for a race that has videos. Returns the render() slots it produces.
function buildVideoPlayer(summary, videoFiles, opts) {
  const { racers, fullVideoFiles, mergedVideoFile, clipTimes, hasClipTimes, placementOrder, ffmpegDir, traceFiles, harFiles } = opts;
  const isTie = summary.overallWinner === 'tie';
  const videoElements = placementOrder.map((origIdx, displayIdx) => {
    const color = RACER_CSS_COLORS[origIdx % RACER_CSS_COLORS.length];
    const racer = racers[origIdx];
    const isWinner = isTie || (summary.overallWinner && summary.overallWinner.toLowerCase() === racer.toLowerCase());
    const vSrc = videoFiles[origIdx].startsWith('data:') ? '' : ` src="${escHtml(videoFiles[origIdx])}"`;
    return `  <div class="racer">
    <div class="racer-label" style="color: ${color}">${trophyHtml(isWinner, isTie)}${escHtml(racer)}</div>
    <video id="v${displayIdx}"${vSrc} preload="auto" muted playsinline disablepictureinpicture crossorigin="anonymous" aria-label="Race recording for ${escHtml(racer)}" data-racer-name="${escHtml(racer)}"></video>
  </div>`;
  }).join('\n');

  const mergedVideoElement = mergedVideoFile ? `
<div class="merged-container" id="mergedContainer" style="display: none;">
  <video id="mergedVideo" src="${escHtml(mergedVideoFile)}" preload="auto" muted playsinline disablepictureinpicture crossorigin="anonymous" aria-label="Side-by-side merged video"></video>
</div>` : '';

  const videoIds = placementOrder.map((_, i) => `v${i}`);
  const raceConfigJson = serializeRaceConfig({
    videoCount: videoIds.length,
    raceVideoPaths: placementOrder.map(i => videoFiles[i]),
    fullVideoPaths: fullVideoFiles ? placementOrder.map(i => fullVideoFiles[i]) : null,
    clipTimes: clipTimes ? placementOrder.map(i => clipTimes[i] || null) : null,
    racerNames: placementOrder.map(i => racers[i]),
    racerColors: placementOrder.map(i => RACER_CSS_COLORS[i % RACER_CSS_COLORS.length]),
    tracePaths: traceFiles ? placementOrder.map(i => traceFiles[i] || null) : null,
    harPaths: harFiles ? placementOrder.map(i => harFiles[i] || null) : null,
    ffmpegDir,
  });

  return {
    playerSection: buildPlayerSectionHtml(videoElements, mergedVideoElement),
    debugPanelOut: hasClipTimes ? buildDebugPanelHtml(racers, placementOrder, clipTimes) : '',
    scriptTag: buildPlayerScript(),
    raceConfigJson,
  };
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles, options = {}) {
  const { fullVideoFiles, mergedVideoFile, traceFiles, harFiles, raceScriptFiles, settingsFileCopied, runNavigation, clipTimes, ffmpegPathPrefix, runSummaries } = options;

  const ffmpegDir = (ffmpegPathPrefix || './') + 'ffmpeg/';
  const racers = summary.racers;
  const count = racers.length;

  const title = count === 2
    ? `Race: ${escHtml(racers[0])} vs ${escHtml(racers[1])}`
    : `Race: ${racers.map(escHtml).join(' vs ')}`;

  const hasVideos = videoFiles && videoFiles.length > 0;
  const placementOrder = getPlacementOrder(summary);
  // Same predicate the browser runtime uses (calibration.cjs isValidClipEntry).
  const hasClipTimes = clipTimes?.some(calibration.isValidClipEntry);
  const hasMergedVideo = !!mergedVideoFile;

  const { playerSection = '', scriptTag = '', raceConfigJson = '', debugPanelOut = '' } = hasVideos
    ? buildVideoPlayer(summary, videoFiles, { racers, fullVideoFiles, mergedVideoFile, clipTimes, hasClipTimes, placementOrder, ffmpegDir, traceFiles, harFiles })
    : {};

  const mergedBtn = hasMergedVideo ? '<button class="mode-btn" id="modeMerged" title="Side-by-side merged video">Merged</button>' : '';
  const modeToggle = hasMergedVideo ? `
  <div class="mode-toggle">
    ${mergedBtn}
  </div>` : '';

  const profileComparison = summary.profileComparison || {};
  const layoutCss = `.player-container { max-width: ${playerContainerMaxWidth(count)}px; }\n  .racer { max-width: ${playerMaxWidth(count)}px; }`;
  return render(TEMPLATE, {
    title,
    styles: buildStyles(layoutCss),
    runNav: buildRunNavHtml(runNavigation, racers, runSummaries),
    winnerBanner: '',
    videoSourceNote: '',
    raceInfo: buildRaceInfoHtml(summary),
    machineInfo: buildMachineInfoHtml(summary.machineInfo),
    errors: buildErrorsHtml(summary.errors),
    modeToggle,
    playerSection,
    debugPanel: debugPanelOut,
    results: buildResultsHtml(summary.comparisons || [], racers),
    runComparison: buildRunComparisonHtml(runSummaries || null, summary, racers),
    profileSummary: buildProfileSummaryHtml({
      ...profileComparison,
      sectionComparisons: summary.comparisons || [],
    }, racers),
    profile: buildProfileHtml({
      ...profileComparison,
      sectionComparisons: summary.comparisons || [],
      rawProfileMetrics: summary.profileMetrics || [],
    }, racers),
    files: buildFilesHtml(racers, videoFiles, {
      fullVideoFiles, mergedVideoFile, traceFiles, harFiles, raceScriptFiles, settingsFileCopied, altFormat, altFiles, placementOrder,
    }),
    notesContent: summary.geminiCommentary
      ? `🤖 Gemini Race Commentary\n${'─'.repeat(40)}\n${escHtml(summary.geminiCommentary)}`
      : '',
    notesOpen: summary.geminiCommentary ? 'open' : '',
    scriptTag,
    raceConfigJson,
  });
}
