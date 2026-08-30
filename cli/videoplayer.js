/**
 * Generates a self-contained HTML file with a retro Grand Prix styled
 * video player for race results. Supports 2-5 racers.
 *
 * The HTML structure lives in player.html (a real HTML template).
 * The CSS lives in player.css (inlined into the exported HTML at build time).
 * Section builders live in player-sections.js.
 * The browser-side player runtime lives in player-runtime.js.
 * This module wires everything together via {{placeholder}} replacement.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RAW_HTML = fs.readFileSync(path.join(__dirname, 'player.html'), 'utf-8');
const RUNTIME = fs.readFileSync(path.join(__dirname, 'player-runtime.js'), 'utf-8');
const CSS = fs.readFileSync(path.join(__dirname, 'player.css'), 'utf-8');

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

function buildPlayerScript(config) {
  return '<script>\n(function() {\n' +
    render(RUNTIME, config) +
    '\n})();\n</script>';
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

export function buildPlayerHtml(summary, videoFiles, altFormat, altFiles, options = {}) {
  let { fullVideoFiles, mergedVideoFile, traceFiles, harFiles, raceScriptFiles, settingsFileCopied, runNavigation, clipTimes, ffmpegPathPrefix, runSummaries } = options;

  const ffmpegDir = (ffmpegPathPrefix || './') + 'ffmpeg/';
  const racers = summary.racers;
  const count = racers.length;

  const maxWidth = count <= 2 ? 680 : count === 3 ? 450 : 340;
  const containerMaxWidth = count <= 2 ? 1400 : count === 3 ? 1400 : 1440;

  const title = count === 2
    ? `Race: ${escHtml(racers[0])} vs ${escHtml(racers[1])}`
    : `Race: ${racers.map(escHtml).join(' vs ')}`;

  const winnerBanner = '';

  const hasVideos = videoFiles && videoFiles.length > 0;
  const placementOrder = getPlacementOrder(summary);

  const hasFullVideos = fullVideoFiles?.length > 0;
  const isValidClip = (c) => c != null && Number.isFinite(c.start) && Number.isFinite(c.end) && c.start <= c.end;
  const hasClipTimes = clipTimes && clipTimes.some(isValidClip);
  const hasMergedVideo = !!mergedVideoFile;

  let playerSection = '';
  let scriptTag = '';
  let debugPanelOut = '';

  if (hasVideos) {
    const isTie = summary.overallWinner === 'tie';
    const videoElements = placementOrder.map((origIdx, displayIdx) => {
      const color = RACER_CSS_COLORS[origIdx % RACER_CSS_COLORS.length];
      const racer = racers[origIdx];
      const isWinner = isTie
        ? true
        : summary.overallWinner && summary.overallWinner.toLowerCase() === racer.toLowerCase();
      const trophyHtml = isWinner
        ? `<span class="trophy">${isTie ? '&#129309;' : '&#127942;'}</span> `
        : '';
      const vSrc = videoFiles[origIdx].startsWith('data:') ? '' : ` src="${escHtml(videoFiles[origIdx])}"`;
      return `  <div class="racer">
    <div class="racer-label" style="color: ${color}">${trophyHtml}${escHtml(racer)}</div>
    <video id="v${displayIdx}"${vSrc} preload="auto" muted playsinline disablepictureinpicture crossorigin="anonymous" aria-label="Race recording for ${escHtml(racer)}" data-racer-name="${escHtml(racer)}"></video>
  </div>`;
    }).join('\n');

    const mergedVideoElement = mergedVideoFile ? `
<div class="merged-container" id="mergedContainer" style="display: none;">
  <video id="mergedVideo" src="${escHtml(mergedVideoFile)}" preload="auto" muted playsinline disablepictureinpicture crossorigin="anonymous" aria-label="Side-by-side merged video"></video>
</div>` : '';

    debugPanelOut = hasClipTimes ? buildDebugPanelHtml(racers, placementOrder, clipTimes) : '';
    playerSection = buildPlayerSectionHtml(videoElements, mergedVideoElement);

    const videoIds = placementOrder.map((_, i) => `v${i}`);
    const orderedVideoFiles = placementOrder.map(i => videoFiles[i]);
    const orderedFullVideoFiles = fullVideoFiles ? placementOrder.map(i => fullVideoFiles[i]) : null;
    const orderedClipTimes = clipTimes ? placementOrder.map(i => clipTimes[i] || null) : null;
    const orderedRacerNames = placementOrder.map(i => racers[i]);
    const orderedRacerColors = placementOrder.map(i => RACER_CSS_COLORS[i % RACER_CSS_COLORS.length]);
    const orderedTraceFiles = traceFiles ? placementOrder.map(i => traceFiles[i] || null) : null;
    const orderedHarFiles = harFiles ? placementOrder.map(i => harFiles[i] || null) : null;

    scriptTag = buildPlayerScript({
      videoVars: videoIds.map(id => `const ${id} = document.getElementById('${id}');`).join('\n  '),
      videoArray: `[${videoIds.join(', ')}]`,
      raceVideoPaths: JSON.stringify(orderedVideoFiles),
      fullVideoPaths: orderedFullVideoFiles
        ? JSON.stringify(orderedFullVideoFiles)
        : 'null',
      clipTimesJson: orderedClipTimes
        ? JSON.stringify(orderedClipTimes)
        : 'null',
      racerNamesJson: JSON.stringify(orderedRacerNames),
      racerColorsJson: JSON.stringify(orderedRacerColors),
      tracePathsJson: orderedTraceFiles ? JSON.stringify(orderedTraceFiles) : 'null',
      harPathsJson: orderedHarFiles ? JSON.stringify(orderedHarFiles) : 'null',
      ffmpegDir,
    });
  }

  const mergedBtn = hasMergedVideo ? '<button class="mode-btn" id="modeMerged" title="Side-by-side merged video">Merged</button>' : '';
  const modeToggle = hasMergedVideo ? `
  <div class="mode-toggle">
    ${mergedBtn}
  </div>` : '';

  const layoutCss = `.player-container { max-width: ${containerMaxWidth}px; }\n  .racer { max-width: ${maxWidth}px; }`;
  return render(TEMPLATE, {
    title,
    styles: buildStyles(layoutCss),
    runNav: buildRunNavHtml(runNavigation, racers, runSummaries),
    winnerBanner,
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
      ...(summary.profileComparison || {}),
      sectionComparisons: summary.comparisons || [],
    }, racers),
    profile: buildProfileHtml({
      ...(summary.profileComparison || {}),
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
  });
}
