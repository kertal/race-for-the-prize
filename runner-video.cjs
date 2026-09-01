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

const OLD_VIDEO_CLEANUP_MS = 5000;      // Age threshold for deleting stale recordings
const FFMPEG_TIMEOUT_MS = 120000;       // Timeout for ffmpeg operations

/** Return the most recently modified .webm filename in a directory, or null. */
function getMostRecentVideo(dir) {
  try {
    dir = path.resolve(dir);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.webm'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime.getTime() }))
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
  videoPath = path.resolve(videoPath);
  const dir = path.dirname(videoPath);
  const ext = path.extname(videoPath);
  const base = path.basename(videoPath, ext);
  const fullPath = path.join(dir, `${base}_full${ext}`);

  fs.copyFileSync(videoPath, fullPath);

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
      const trimmedPath = path.join(dir, `${base}_trimmed${ext}`);
      execFileSync('ffmpeg', [
        '-y', '-i', videoPath,
        '-ss', seg.start.toFixed(3), '-t', (seg.end - seg.start).toFixed(3),
        '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
        trimmedPath
      ], { timeout: FFMPEG_TIMEOUT_MS, stdio: 'pipe' });
      fs.unlinkSync(videoPath);
      fs.renameSync(trimmedPath, videoPath);
      return { trimmedPath: videoPath, fullPath };
    }

    // Multiple segments: extract each then concatenate
    const segmentFiles = [];
    const concatListPath = path.join(dir, `${base}_concat.txt`);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segPath = path.join(dir, `${base}_seg${i}${ext}`);
      segmentFiles.push(segPath);
      execFileSync('ffmpeg', [
        '-y', '-i', videoPath,
        '-ss', seg.start.toFixed(3), '-t', (seg.end - seg.start).toFixed(3),
        '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
        segPath
      ], { timeout: FFMPEG_TIMEOUT_MS, stdio: 'pipe' });
    }

    fs.writeFileSync(concatListPath, segmentFiles.map(f => `file '${f}'`).join('\n'));
    const outputPath = path.join(dir, `${base}_final${ext}`);
    execFileSync('ffmpeg', [
      '-y', '-f', 'concat', '-safe', '0',
      '-i', concatListPath, '-c', 'copy', outputPath
    ], { timeout: FFMPEG_TIMEOUT_MS, stdio: 'pipe' });

    for (const f of segmentFiles) { try { fs.unlinkSync(f); } catch (e) { console.error(`[extractSegments] Cleanup warning: ${e.message}`); } }
    try { fs.unlinkSync(concatListPath); } catch (e) { console.error(`[extractSegments] Cleanup warning: ${e.message}`); }
    fs.unlinkSync(videoPath);
    fs.renameSync(outputPath, videoPath);

    return { trimmedPath: videoPath, fullPath };
  } catch (error) {
    console.error(`[${browserId}] Failed to extract segments (ffmpeg may not be installed): ${error.message}`);
    try {
      for (const file of fs.readdirSync(dir)) {
        if (['_seg', '_concat', '_final', '_trimmed'].some(p => file.includes(p))) {
          try { fs.unlinkSync(path.join(dir, file)); } catch {}
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
      const filepath = path.join(dir, file);
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
  const videoPath = path.join(outputDir, videoFile);
  const res = extractSegments(videoPath, trimSegments, id);
  return path.basename(res.fullPath);
}

module.exports = { getMostRecentVideo, extractSegments, cleanupOldVideos, trimVideoWithFfmpeg };
