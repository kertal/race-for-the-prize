/**
 * File management for race results: move recordings and convert video formats.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { c } from './colors.js';
import { FORMAT_EXTENSIONS, VIDEO_DEFAULTS, codecArgs } from './media-config.js';
import { raceVideoFile, fullVideoFile, traceFile, harFile } from './paths.js';

/** Move recordings from the runner's temp dir to the results folder. */
export function moveResults(recordingsBase, racerName, destDir, browserResult) {
  const sourceDir = path.join(recordingsBase, racerName);
  const data = {
    videoPath: null,
    fullVideoPath: null,
    tracePath: null,
    harPath: null,
    measurements: browserResult.measurements || [],
    profileMetrics: browserResult.profileMetrics || null,
    error: browserResult.error || null,
  };

  try {
    if (!fs.existsSync(sourceDir)) return data;
    fs.mkdirSync(destDir, { recursive: true });

    const files = fs.readdirSync(sourceDir);
    for (const file of files) {
      fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
      fs.unlinkSync(path.join(sourceDir, file));
    }

    const webms = files.filter(f => f.endsWith('.webm'));
    const fullVideo = webms.find(f => f.includes('_full'));
    // Prefer a dedicated (trimmed) video as the main race video; fall back to
    // the full video or any single file. Crucially, when only a _full video
    // exists, mainVideo === fullVideo — we must NOT rename the same file twice
    // (the second rename would ENOENT and abort, dropping measurements.json).
    const mainVideo = webms.find(f => !f.includes('_full')) || fullVideo || webms[0];
    if (mainVideo) {
      const renamed = raceVideoFile(racerName);
      fs.renameSync(path.join(destDir, mainVideo), path.join(destDir, renamed));
      data.videoPath = path.join(destDir, renamed);
    }
    if (fullVideo && fullVideo !== mainVideo) {
      const renamed = fullVideoFile(racerName);
      fs.renameSync(path.join(destDir, fullVideo), path.join(destDir, renamed));
      data.fullVideoPath = path.join(destDir, renamed);
    }

    const sourceTrace = files.find(f => f.endsWith('.trace.json'));
    if (sourceTrace) {
      const renamed = traceFile(racerName);
      fs.renameSync(path.join(destDir, sourceTrace), path.join(destDir, renamed));
      data.tracePath = path.join(destDir, renamed);
    }

    const sourceHar = files.find(f => f.endsWith('.har'));
    if (sourceHar) {
      const renamed = harFile(racerName);
      fs.renameSync(path.join(destDir, sourceHar), path.join(destDir, renamed));
      data.harPath = path.join(destDir, renamed);
    }

    fs.writeFileSync(path.join(destDir, 'measurements.json'), JSON.stringify(data.measurements, null, 2));
    fs.writeFileSync(path.join(destDir, 'profile-metrics.json'), JSON.stringify(data.profileMetrics, null, 2));
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

/** Files from @ffmpeg/ffmpeg ESM dist needed for browser-side conversion. */
const FFMPEG_ESM_FILES = ['index.js', 'classes.js', 'const.js', 'errors.js', 'types.js', 'utils.js', 'worker.js'];

/** Files from @ffmpeg/core ESM dist needed for browser-side conversion. */
const FFMPEG_CORE_FILES = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

/**
 * Copy ffmpeg.wasm files to a `ffmpeg/` subdirectory alongside the output HTML.
 * Uses the locally installed @ffmpeg/ffmpeg and @ffmpeg/core packages.
 * Returns true if files were copied successfully, false otherwise.
 */
export function copyFFmpegFiles(destDir) {
  const ffmpegDir = path.join(destDir, 'ffmpeg');
  try {
    const require = createRequire(import.meta.url);
    // Resolve package roots by finding the nearest package.json walking up from
    // the resolved entry point. Using `require.resolve('@ffmpeg/ffmpeg/package.json')`
    // directly fails when the package.json isn't listed in the `exports` map.
    const findPackageRoot = (specifier) => {
      let dir = path.dirname(require.resolve(specifier));
      while (dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
            if (pkg.name === specifier) return dir;
          } catch {}
        }
        dir = path.dirname(dir);
      }
      throw new Error(`Could not locate package root for ${specifier}`);
    };
    const ffmpegEsmDir = path.join(findPackageRoot('@ffmpeg/ffmpeg'), 'dist', 'esm');
    const coreEsmDir = path.join(findPackageRoot('@ffmpeg/core'), 'dist', 'esm');

    fs.mkdirSync(ffmpegDir, { recursive: true });

    for (const file of FFMPEG_ESM_FILES) {
      const src = path.join(ffmpegEsmDir, file);
      const dest = path.join(ffmpegDir, file);
      fs.copyFileSync(src, dest);
    }
    for (const file of FFMPEG_CORE_FILES) {
      const src = path.join(coreEsmDir, file);
      const dest = path.join(ffmpegDir, file);
      fs.copyFileSync(src, dest);
    }
    return true;
  } catch (e) {
    console.error(`${c.dim}Warning: Could not copy ffmpeg.wasm files: ${e.message}${c.reset}`);
    try { fs.rmSync(ffmpegDir, { recursive: true, force: true }); } catch {}
    return false;
  }
}

/** True if an `ffmpeg` binary is callable on PATH. */
function ffmpegAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' }); // NOSONAR — ffmpeg resolved via PATH is intentional (optional user-installed system dep); args are an array (no shell)
    return true;
  } catch {
    return false;
  }
}

/** Convert .webm videos to the requested format (mov/gif) via ffmpeg. */
export function convertVideos(results, format) {
  const ext = FORMAT_EXTENSIONS[format];
  if (!ext) {
    console.error(`${c.dim}Warning: Unknown format "${format}", skipping conversion${c.reset}`);
    return;
  }
  // Converting webm→webm would run `ffmpeg -i src ... src`, reading and
  // overwriting the same file in place and corrupting it. There is nothing to
  // convert, so skip.
  if (ext === FORMAT_EXTENSIONS.webm) return;
  // Preflight ffmpeg once. Without this every file logs an ENOENT warning and
  // the summary still advertises .mov/.gif paths that were never produced.
  if (!ffmpegAvailable()) {
    console.error(`${c.dim}Warning: ffmpeg not found — keeping .webm, skipping ${format} conversion${c.reset}`);
    return;
  }
  for (const r of results) {
    for (const key of ['videoPath', 'fullVideoPath']) {
      if (!r[key]) continue;
      const src = r[key];
      const dest = src.replace(/\.webm$/, ext);
      try {
        const args = ['-y', '-i', src];
        const codec = codecArgs(format);
        if (codec.length > 0) {
          // libx264 (MOV) requires even dimensions; trunc rounds down to even
          if (format === 'mov') args.push('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
          args.push(...codec);
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
