/**
 * Generates a self-contained HTML file with a retro Grand Prix styled
 * video player for race results. Supports 2-5 racers.
 *
 * The HTML structure lives in player.html (a real HTML template).
 * The CSS lives in player.css (inlined into the exported HTML at build time),
 *   written as design tokens + component rules so it can be re-skinned.
 * Skins live in cli/skins/ and are resolved by skins.js; the chosen one is
 *   inlined after player.css and its name stamped onto <html data-theme>.
 * Section builders live in player-sections.js.
 * The browser-side player runtime lives in player-runtime/ as concern-scoped
 * source files, concatenated below in dependency order into one IIFE scope.
 * This module wires everything together via {{placeholder}} replacement.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplates, escHtml, render } from './html-templates.js';
import {
  RACER_CSS_COLORS,
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
import { resolveSkin, DEFAULT_THEME_COLOR } from './skins.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Markup lives in player.html: the page shell plus one build-* template per
// repeated fragment, split apart here and filled at build time.
const { shell: TEMPLATE, templates: BUILD_TEMPLATES, fill } = loadTemplates(path.join(__dirname, 'player.html'));
setTemplates(BUILD_TEMPLATES);

// Shared design tokens first, then this page's component rules. Both reports
// inline the same tokens.css so the player and the condition overview cannot
// drift apart, and one skin themes both.
const CSS = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf-8') + '\n'
  + fs.readFileSync(path.join(__dirname, 'player.css'), 'utf-8');

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
  'export-zip.js',     // self-contained HTML/ZIP export flows
];
const RUNTIME = RUNTIME_FILES
  .map(f => fs.readFileSync(path.join(__dirname, 'player-runtime', f), 'utf-8'))
  .join('\n');

// ---------------------------------------------------------------------------
// Style & Script Builders — read from external files and inline at export
// ---------------------------------------------------------------------------

function buildStyles(layoutCss) {
  return '<style>\n' + CSS + '  ' + layoutCss + '\n</style>';
}

/**
 * Inline a resolved skin after the base stylesheet so its token overrides win.
 * Returns '' when no skin was requested.
 */
function buildSkinStyles(skin) {
  return skin ? `<style id="rftp-skin">\n${skin.css}\n</style>` : '';
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
  return fill('trophy', { medal: isTie ? '&#129309;' : '&#127942;' });
}

// Build the player section, debug panel, runtime script tag, and race-config
// JSON for a race that has videos. Returns the render() slots it produces.
function buildVideoPlayer(summary, videoFiles, opts) {
  const { racers, fullVideoFiles, mergedVideoFile, clipTimes, hasClipTimes, displayOrder, ffmpegDir } = opts;
  const isTie = summary.overallWinner === 'tie';
  const videoElements = displayOrder.map((origIdx, displayIdx) => {
    const color = RACER_CSS_COLORS[origIdx % RACER_CSS_COLORS.length];
    const racer = racers[origIdx];
    const isWinner = isTie || (summary.overallWinner && summary.overallWinner.toLowerCase() === racer.toLowerCase());
    // A data: URI is swapped in by the runtime, so the attribute starts empty.
    return fill('racer-card', {
      color,
      idx: displayIdx,
      name: escHtml(racer),
      trophy: trophyHtml(isWinner, isTie),
      src: videoFiles[origIdx].startsWith('data:') ? '' : ` src="${escHtml(videoFiles[origIdx])}"`,
    });
  }).join('\n');

  const mergedVideoElement = mergedVideoFile
    ? fill('merged-container', { src: escHtml(mergedVideoFile) })
    : '';

  const videoIds = displayOrder.map((_, i) => `v${i}`);
  const raceConfigJson = serializeRaceConfig({
    videoCount: videoIds.length,
    raceVideoPaths: displayOrder.map(i => videoFiles[i]),
    fullVideoPaths: fullVideoFiles ? displayOrder.map(i => fullVideoFiles[i]) : null,
    clipTimes: clipTimes ? displayOrder.map(i => clipTimes[i] || null) : null,
    racerNames: displayOrder.map(i => racers[i]),
    racerColors: displayOrder.map(i => RACER_CSS_COLORS[i % RACER_CSS_COLORS.length]),
    ffmpegDir,
  });

  return {
    playerSection: buildPlayerSectionHtml(videoElements, mergedVideoElement),
    debugPanelOut: hasClipTimes ? buildDebugPanelHtml(racers, displayOrder, clipTimes) : '',
    scriptTag: buildPlayerScript(),
    raceConfigJson,
  };
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles, options = {}) {
  const { fullVideoFiles, mergedVideoFile, traceFiles, harFiles, raceScriptFiles, settingsFileCopied, runNavigation, clipTimes, ffmpegPathPrefix, runSummaries, skin, skinBaseDir } = options;

  const ffmpegDir = (ffmpegPathPrefix || './') + 'ffmpeg/';
  const racers = summary.racers;
  const count = racers.length;

  const title = count === 2
    ? `Race: ${escHtml(racers[0])} vs ${escHtml(racers[1])}`
    : `Race: ${racers.map(escHtml).join(' vs ')}`;

  const hasVideos = videoFiles && videoFiles.length > 0;
  // Racers appear everywhere on the page in the order they were declared —
  // videos, calibration rows and file links alike. The results tables rank
  // them; the recordings stay where the viewer expects to find them, so the
  // same racer is in the same place across every run of a race.
  const displayOrder = racers.map((_, i) => i);
  // Same predicate the browser runtime uses (calibration.cjs isValidClipEntry).
  const hasClipTimes = clipTimes?.some(calibration.isValidClipEntry);
  const hasMergedVideo = !!mergedVideoFile;

  const { playerSection = '', scriptTag = '', raceConfigJson = '', debugPanelOut = '' } = hasVideos
    ? buildVideoPlayer(summary, videoFiles, { racers, fullVideoFiles, mergedVideoFile, clipTimes, hasClipTimes, displayOrder, ffmpegDir })
    : {};

  const modeToggle = hasMergedVideo ? fill('mode-toggle') : '';

  const profileComparison = summary.profileComparison || {};
  const layoutCss = `.player-container { max-width: ${playerContainerMaxWidth(count)}px; }\n  .racer { max-width: ${playerMaxWidth(count)}px; }`;
  const resolvedSkin = resolveSkin(skin, skinBaseDir);
  return render(TEMPLATE, {
    title,
    themeAttr: resolvedSkin ? ` data-theme="${escHtml(resolvedSkin.name)}"` : '',
    themeColor: resolvedSkin ? escHtml(resolvedSkin.themeColor) : DEFAULT_THEME_COLOR,
    styles: buildStyles(layoutCss),
    skinStyles: buildSkinStyles(resolvedSkin),
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
      fullVideoFiles, mergedVideoFile, traceFiles, harFiles, raceScriptFiles, settingsFileCopied, altFormat, altFiles, displayOrder,
    }),
    notesContent: summary.geminiCommentary
      ? `🤖 Gemini Race Commentary\n${'─'.repeat(40)}\n${escHtml(summary.geminiCommentary)}`
      : '',
    notesOpen: summary.geminiCommentary ? 'open' : '',
    scriptTag,
    raceConfigJson,
  });
}
