/**
 * FFmpeg-based side-by-side video export for CLI race results.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { c } from './colors.js';
import { startProgress } from './animation.js';

function codecArgs(format) {
  if (format === 'mov') return ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  if (format === 'gif') return ['-vf', 'fps=10,scale=1280:-1'];
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
    execFileSync('ffmpeg', [
      '-y',
      '-i', video1Path,
      '-i', video2Path,
      '-filter_complex', `[0:v]${pts}scale=640:360[left];[1:v]${pts}scale=640:360[right];[left][right]hstack=inputs=2`,
      ...codecArgs(format),
      outputPath
    ], { timeout: 300000, stdio: 'pipe' });

    progress.done(`Side-by-side: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (e) {
    const stderr = e.stderr?.toString() || e.message;
    progress.fail(`Side-by-side skipped: ${stderr.split('\n').pop()}`);
    return null;
  }
}
