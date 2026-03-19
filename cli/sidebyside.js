/**
 * FFmpeg-based side-by-side video export for CLI race results.
 * Supports 2-5 videos with automatic layout selection.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { c, VIDEO_DEFAULTS, codecArgs } from './colors.js';
import { startProgress } from './animation.js';
import { compressGif } from './results.js';

/**
 * Build FFmpeg filter_complex for N videos.
 * Layouts:
 *   2 videos: hstack (side by side)
 *   3 videos: hstack=inputs=3 (3 across)
 *   4 videos: 2x2 grid (hstack pairs, then vstack)
 *   5 videos: 3 on top, 2 on bottom centered (with padding)
 */
function buildFilterComplex(count, slowmo, format) {
  const pts = slowmo > 0 ? `setpts=${slowmo}*PTS,` : '';
  const { scaleWidth2to3, scaleWidth4to5, gifFps, gifMaxColors, gifBayerScale } = VIDEO_DEFAULTS;
  // GIF optimization: reduced fps, palette generation with Bayer dithering for quality
  const gifTail = format === 'gif'
    ? `,fps=${gifFps},split[s0][s1];[s0]palettegen=max_colors=${gifMaxColors}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=${gifBayerScale}`
    : '';
  const scaleWidth = count <= 3 ? scaleWidth2to3 : scaleWidth4to5;

  if (count === 2) {
    return `[0:v]${pts}scale=${scaleWidth}:-2[v0];[1:v]${pts}scale=${scaleWidth}:-2[v1];[v0][v1]hstack=inputs=2${gifTail}`;
  } else if (count === 3) {
    return `[0:v]${pts}scale=${scaleWidth}:-2[v0];[1:v]${pts}scale=${scaleWidth}:-2[v1];[2:v]${pts}scale=${scaleWidth}:-2[v2];[v0][v1][v2]hstack=inputs=3${gifTail}`;
  } else if (count === 4) {
    // 2x2 grid
    return `[0:v]${pts}scale=${scaleWidth}:-2[v0];[1:v]${pts}scale=${scaleWidth}:-2[v1];[2:v]${pts}scale=${scaleWidth}:-2[v2];[3:v]${pts}scale=${scaleWidth}:-2[v3];[v0][v1]hstack=inputs=2[top];[v2][v3]hstack=inputs=2[bot];[top][bot]vstack=inputs=2${gifTail}`;
  } else if (count === 5) {
    // 3 on top, 2 on bottom with padding to center
    // Bottom row needs half-width padding on each side
    const halfWidth = Math.floor(scaleWidth / 2);
    return `[0:v]${pts}scale=${scaleWidth}:-2[v0];[1:v]${pts}scale=${scaleWidth}:-2[v1];[2:v]${pts}scale=${scaleWidth}:-2[v2];[3:v]${pts}scale=${scaleWidth}:-2[v3];[4:v]${pts}scale=${scaleWidth}:-2[v4];[v0][v1][v2]hstack=inputs=3[top];[v3][v4]hstack=inputs=2[bot2];[bot2]pad=iw+${scaleWidth}:ih:${halfWidth}:0:black[bot];[top][bot]vstack=inputs=2${gifTail}`;
  }
  return '';
}

export function createSideBySide(videoPaths, outputPath, format = 'webm', slowmo = 0) {
  // Filter out null/missing paths
  const validPaths = videoPaths.filter(p => p && fs.existsSync(p));

  if (validPaths.length < 2) {
    process.stderr.write(`  ${c.dim}Skipping side-by-side: at least 2 video files required${c.reset}\n`);
    return null;
  }

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  } catch {
    process.stderr.write(`  ${c.dim}Skipping side-by-side: ffmpeg not found${c.reset}\n`);
    return null;
  }

  const label = slowmo > 0 ? `Creating ${slowmo}x slow-mo side-by-side…` : 'Creating side-by-side video…';
  const progress = startProgress(label);

  try {
    const inputArgs = validPaths.flatMap(p => ['-i', p]);
    const filterComplex = buildFilterComplex(validPaths.length, slowmo, format);

    execFileSync('ffmpeg', [
      '-y',
      ...inputArgs,
      '-filter_complex', filterComplex,
      ...codecArgs(format),
      outputPath
    ], { timeout: 300000, stdio: 'pipe' });

    if (format === 'gif') compressGif(outputPath);

    progress.done(`Side-by-side: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (e) {
    const stderr = e.stderr?.toString() || e.message;
    progress.fail(`Side-by-side skipped: ${stderr.split('\n').pop()}`);
    return null;
  }
}
