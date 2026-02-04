/**
 * FFmpeg-based side-by-side video export for CLI race results.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { c } from './colors.js';
import { startProgress } from './animation.js';
import { compressGif } from './results.js';

function codecArgs(format) {
  if (format === 'mov') return ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  if (format === 'gif') return [];  // GIF-specific filters are applied in filter_complex
  return ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0'];
}

export function createSideBySide(video1Path, video2Path, outputPath, format = 'webm', slowmo = 0) {
  if (!video1Path || !video2Path || !fs.existsSync(video1Path) || !fs.existsSync(video2Path)) {
    process.stderr.write(`  ${c.dim}Skipping side-by-side: both video files required${c.reset}\n`);
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
    const pts = slowmo > 0 ? `setpts=${slowmo}*PTS,` : '';
    const gifTail = format === 'gif' ? ',fps=10,split[s0][s1];[s0]palettegen=max_colors=128:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3' : '';
    execFileSync('ffmpeg', [
      '-y',
      '-i', video1Path,
      '-i', video2Path,
      '-filter_complex', `[0:v]${pts}scale=640:-2[left];[1:v]${pts}scale=640:-2[right];[left][right]hstack=inputs=2${gifTail}`,
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
