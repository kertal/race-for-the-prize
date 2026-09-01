/**
 * runner-video.cjs — video file management for the runner.
 *
 * Owns everything that touches recorded .webm files on disk: locating the
 * most recent recording, ffmpeg-based segment extraction/concatenation for
 * physical trimming, and stale-recording cleanup.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { confinePath } = require('./runner-protocol.cjs');

const OLD_VIDEO_CLEANUP_MS = 5000;      // Age threshold for deleting stale recordings
const FFMPEG_TIMEOUT_MS = 120000;       // Timeout for ffmpeg operations

// ffmpeg is resolved via PATH by default so the CLI works wherever the user
// installed it; set RACE_FFMPEG to an absolute binary path to pin a specific
// build in locked-down environments.
const FFMPEG_BIN = process.env.RACE_FFMPEG ? path.resolve(process.env.RACE_FFMPEG) : 'ffmpeg';

// Non-path ffmpeg arguments: flags, codec/format names, and numbers. Anything
// outside this shape (a stray '-'-prefixed value, a relative path, an empty
// string) would be a bug in a caller, not a legitimate argument.
const FFMPEG_SAFE_ARG = /^-?[A-Za-z0-9][A-Za-z0-9_.:=-]*$/;

/**
 * Run ffmpeg with arguments proven inert before the process is spawned:
 * every absolute argument must resolve inside `dir` (so it can address only
 * this racer's own recording files), and every other argument must be a plain
 * flag/name/number. A path can therefore never be read as an option, and an
 * injected value can never reach the OS — it throws here instead.
 *
 * Centralising the spawn also keeps the three trim/concat call sites from each
 * repeating the argument contract.
 */
function assertSafeFfmpegArgs(args, dir) {
  const root = path.resolve(dir);
  for (const arg of args) {
    if (typeof arg !== 'string' || arg === '') {
      throw new Error(`Refusing to run ffmpeg: argument is not a non-empty string (${String(arg)})`);
    }
    if (path.isAbsolute(arg)) {
      if (arg !== root && !arg.startsWith(root + path.sep)) {
        throw new Error(`Refusing to run ffmpeg: path argument escapes ${root}: ${arg}`);
      }
      continue;
    }
    if (!FFMPEG_SAFE_ARG.test(arg)) {
      throw new Error(`Refusing to run ffmpeg: unexpected argument ${JSON.stringify(arg)}`);
    }
  }
}

function runFfmpeg(args, dir) {
  assertSafeFfmpegArgs(args, dir);
  // Arguments are validated by assertSafeFfmpegArgs above: absolute paths are
  // confined to the recording dir, all others match FFMPEG_SAFE_ARG.
  execFileSync(FFMPEG_BIN, args, { timeout: FFMPEG_TIMEOUT_MS, stdio: 'pipe' }); // NOSONAR — args validated by assertSafeFfmpegArgs (confined paths + flag/name/number allowlist); array form, no shell; ffmpeg via PATH is intentional (optional user-installed dep, pin with RACE_FFMPEG)
}

/** Return the most recently modified .webm filename in a directory, or null. */
function getMostRecentVideo(dir) {
  try {
    dir = path.resolve(dir);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.webm'))
      .map(f => ({ name: f, mtime: fs.statSync(confinePath(dir, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].name : null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract recording segments from a full video and concatenate them.
 * Uses pre-computed PTS segments for frame-accurate cutting.
 * Keeps the original as a `_full` copy. Requires ffmpeg.
 */
function extractSegments(videoPath, segments, browserId) {
  // Resolve to an absolute path so every derived path stays anchored and can
  // never be parsed as an ffmpeg option (absolute paths cannot start with -).
  // All derived working files go through confinePath so they provably stay in
  // the video's own directory.
  videoPath = path.resolve(videoPath);
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  videoPath = confinePath(dir, `${base}${ext}`);
  const fullPath = confinePath(dir, `${base}_full${ext}`);

  fs.copyFileSync(videoPath, fullPath); // NOSONAR — both paths come from confinePath (proven inside the recording dir)

  // Only numeric, ordered segments may reach ffmpeg's -ss/-t arguments.
  segments = (segments || []).filter(
    s => Number.isFinite(s?.start) && Number.isFinite(s?.end) && s.end > s.start
  );
  if (segments.length === 0) {
    return { trimmedPath: videoPath, fullPath };
  }

  try {
    if (segments.length === 1) {
      const seg = segments[0];
      const trimmedPath = confinePath(dir, `${base}_trimmed${ext}`);
      runFfmpeg([
        '-y', '-i', videoPath,
        '-ss', seg.start.toFixed(3), '-t', (seg.end - seg.start).toFixed(3),
        '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
        trimmedPath
      ], dir);
      fs.unlinkSync(videoPath); // NOSONAR — confinePath-derived recording path
      fs.renameSync(trimmedPath, videoPath); // NOSONAR — confinePath-derived recording paths
      return { trimmedPath: videoPath, fullPath };
    }

    // Multiple segments: extract each then concatenate
    const segmentFiles = [];
    const concatListPath = confinePath(dir, `${base}_concat.txt`);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segPath = confinePath(dir, `${base}_seg${i}${ext}`);
      segmentFiles.push(segPath);
      runFfmpeg([
        '-y', '-i', videoPath,
        '-ss', seg.start.toFixed(3), '-t', (seg.end - seg.start).toFixed(3),
        '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
        segPath
      ], dir);
    }

    // Quote-safe the concat list: the ffmpeg concat demuxer wraps each path in
    // single quotes, so a literal ' in a derived path must be written as '\''
    // (close, escaped quote, reopen) or the input line is silently mangled.
    const concatEntry = (f) => `file '${f.replace(/'/g, "'\\''")}'`;
    fs.writeFileSync(concatListPath, segmentFiles.map(concatEntry).join('\n')); // NOSONAR — concatListPath is confined to the recording dir (confinePath) with a fixed name, not user input
    const outputPath = confinePath(dir, `${base}_final${ext}`);
    runFfmpeg([
      '-y', '-f', 'concat', '-safe', '0',
      '-i', concatListPath, '-c', 'copy', outputPath
    ], dir);

    for (const f of segmentFiles) { try { fs.unlinkSync(f); } catch (e) { console.error(`[extractSegments] Cleanup warning: ${e.message}`); } }
    try { fs.unlinkSync(concatListPath); } catch (e) { console.error(`[extractSegments] Cleanup warning: ${e.message}`); }
    fs.unlinkSync(videoPath); // NOSONAR — confinePath-derived recording path
    fs.renameSync(outputPath, videoPath); // NOSONAR — confinePath-derived recording paths

    return { trimmedPath: videoPath, fullPath };
  } catch (error) {
    console.error(`[${browserId}] Failed to extract segments (ffmpeg may not be installed): ${error.message}`);
    try {
      for (const file of fs.readdirSync(dir)) {
        if (['_seg', '_concat', '_final', '_trimmed'].some(p => file.includes(p))) {
          try { fs.unlinkSync(confinePath(dir, file)); } catch {}
        }
      }
    } catch {}
    return { trimmedPath: videoPath, fullPath };
  }
}

/** Delete .webm files older than 5 seconds in a directory. */
function cleanupOldVideos(dir) {
  try {
    dir = path.resolve(dir);
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.webm'))) {
      const filepath = confinePath(dir, file);
      if (now - fs.statSync(filepath).mtime.getTime() > OLD_VIDEO_CLEANUP_MS) {
        fs.unlinkSync(filepath);
      }
    }
  } catch (e) {
    console.error(`[cleanupOldVideos] Warning: ${e.message}`);
  }
}

/** Trim the most recent recording in outputDir to the given PTS segments. */
function trimVideoWithFfmpeg(outputDir, trimSegments, id) {
  const videoFile = getMostRecentVideo(outputDir);
  if (!videoFile) return null;
  const videoPath = confinePath(outputDir, videoFile);
  const res = extractSegments(videoPath, trimSegments, id);
  return path.basename(res.fullPath);
}

module.exports = { getMostRecentVideo, extractSegments, cleanupOldVideos, trimVideoWithFfmpeg, runFfmpeg, assertSafeFfmpegArgs };
