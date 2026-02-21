// ANSI escape codes
export const c = {
  green: '\x1b[32m', blue: '\x1b[34m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', red: '\x1b[31m', magenta: '\x1b[35m',
  white: '\x1b[37m',
  dim: '\x1b[2m', bold: '\x1b[1m', italic: '\x1b[3m', reset: '\x1b[0m',
  hideCursor: '\x1b[?25l', showCursor: '\x1b[?25h',
};

// Color palette for up to 5 racers
export const RACER_COLORS = [c.red, c.blue, c.green, c.yellow, c.magenta];

// Video format file extensions
export const FORMAT_EXTENSIONS = {
  webm: '.webm',
  mov: '.mov',
  gif: '.gif'
};

// Screen dimensions for window layout
export const SCREEN = {
  width: 1920,
  height: 1080
};

// Video processing defaults
export const VIDEO_DEFAULTS = {
  scaleWidth2to3: 640,    // Scale width for 2-3 video layouts
  scaleWidth4to5: 480,    // Scale width for 4-5 video layouts
  windowHeight: 800,      // Default window height
  gifFps: 10,             // GIF frame rate
  gifMaxColors: 128,      // GIF max color palette
  gifBayerScale: 3        // GIF Bayer dithering scale
};

/**
 * FFmpeg codec arguments by output format.
 * Shared by sidebyside.js and results.js to avoid duplication.
 */
export function codecArgs(format) {
  if (format === 'mov') return ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  if (format === 'gif') return [];  // GIF uses filter_complex pipelines instead
  if (format === 'webm') return ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0'];
  return [];  // Unknown format — let ffmpeg infer from extension
}

// Visual cue detection thresholds for frame-accurate trimming
export const CUE_DETECTION = {
  startHueMin: 130,       // Green cue min hue
  startHueMax: 170,       // Green cue max hue
  startYMax: 80,          // Green cue max Y (luminance)
  endHueMin: 60,          // Red cue min hue
  endHueMax: 100,         // Red cue max hue
  endYMin: 120,           // Red cue min Y (luminance)
  saturationMin: 80       // Min saturation for cue detection
};
