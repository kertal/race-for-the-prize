/**
 * File management for race results: move recordings and convert video formats.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { c, FORMAT_EXTENSIONS, VIDEO_DEFAULTS } from './colors.js';

/** Move recordings from the runner's temp dir to the results folder. */
export function moveResults(recordingsBase, racerName, destDir, browserResult) {
  const sourceDir = path.join(recordingsBase, racerName);
  const data = {
    videoPath: null,
    fullVideoPath: null,
    tracePath: null,
    clickEvents: browserResult.clickEvents || [],
    measurements: browserResult.measurements || [],
    error: browserResult.error || null,
  };

  try {
    if (!fs.existsSync(sourceDir)) return data;

    const files = fs.readdirSync(sourceDir);
    for (const file of files) {
      fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
      fs.unlinkSync(path.join(sourceDir, file));
    }

    const webms = files.filter(f => f.endsWith('.webm'));
    const fullVideo = webms.find(f => f.includes('_full'));
    const mainVideo = webms.find(f => !f.includes('_full')) || webms[0];
    if (mainVideo) {
      const renamed = `${racerName}.race.webm`;
      fs.renameSync(path.join(destDir, mainVideo), path.join(destDir, renamed));
      data.videoPath = path.join(destDir, renamed);
    }
    if (fullVideo) {
      const renamed = `${racerName}.full.webm`;
      fs.renameSync(path.join(destDir, fullVideo), path.join(destDir, renamed));
      data.fullVideoPath = path.join(destDir, renamed);
    }

    const traceFile = files.find(f => f.endsWith('.trace.json'));
    if (traceFile) {
      const renamed = `${racerName}.trace.json`;
      fs.renameSync(path.join(destDir, traceFile), path.join(destDir, renamed));
      data.tracePath = path.join(destDir, renamed);
    }

    fs.writeFileSync(path.join(destDir, 'clicks.json'), JSON.stringify(data.clickEvents, null, 2));
    fs.writeFileSync(path.join(destDir, 'measurements.json'), JSON.stringify(data.measurements, null, 2));
  } catch (e) {
    console.error(`${c.dim}Warning: Could not move ${racerName} results: ${e.message}${c.reset}`);
  }

  return data;
}

/** Compress a GIF in-place using gifsicle (if available). */
export function compressGif(filePath) {
  try {
    execFileSync('gifsicle', ['-O3', '--lossy=80', '--colors', '128', '-b', filePath], { timeout: 300000, stdio: 'pipe' });
  } catch {
    // gifsicle not available — ffmpeg output is already optimised
  }
}

/** Convert .webm videos to the requested format (mov/gif) via ffmpeg. */
export function convertVideos(results, format) {
  for (const r of results) {
    for (const key of ['videoPath', 'fullVideoPath']) {
      if (!r[key]) continue;
      const src = r[key];
      const ext = FORMAT_EXTENSIONS[format] || FORMAT_EXTENSIONS.gif;
      const dest = src.replace(/\.webm$/, ext);
      try {
        const args = ['-y', '-i', src];
        if (format === 'mov') {
          args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
        } else {
          // GIF optimization: fps, scale, palette generation with Bayer dithering
          const { scaleWidth2to3, gifFps, gifMaxColors, gifBayerScale } = VIDEO_DEFAULTS;
          args.push('-filter_complex', `fps=${gifFps},scale=${scaleWidth2to3}:-2,split[s0][s1];[s0]palettegen=max_colors=${gifMaxColors}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=${gifBayerScale}`);
        }
        args.push(dest);
        execFileSync('ffmpeg', args, { timeout: 300000, stdio: 'pipe' });
        if (format === 'gif') compressGif(dest);
        r[key] = dest;
      } catch (e) {
        console.error(`${c.dim}Warning: Could not convert ${path.basename(src)}: ${e.message}${c.reset}`);
      }
    }
  }
}
