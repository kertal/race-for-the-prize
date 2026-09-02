/**
 * runner-layout.cjs — window position/size math for N parallel browsers.
 * Pure geometry; screen dimensions are passed in by the caller.
 */

/**
 * Calculate window position and size for browser at given index.
 * For 2 browsers: side-by-side horizontally
 * For 3 browsers: 3 across
 * For 4 browsers: 2x2 grid
 * For 5 browsers: 3 on top, 2 on bottom
 *
 * @param {number} index Browser index (0-based)
 * @param {number} total Total browser count
 * @param {{screen: {width: number, height: number}, windowHeight: number}} dims
 */
function calculateWindowLayout(index, total, { screen, windowHeight }) {
  const { width: screenWidth, height: screenHeight } = screen;

  if (total <= 2) {
    // Side by side
    const width = Math.floor(screenWidth / 2);
    return { x: index * width, y: 0, width, height: windowHeight };
  } else if (total === 3) {
    // 3 across
    const width = Math.floor(screenWidth / 3);
    return { x: index * width, y: 0, width, height: windowHeight };
  } else if (total === 4) {
    // 2x2 grid
    const width = Math.floor(screenWidth / 2);
    const height = Math.floor(screenHeight / 2);
    const row = Math.floor(index / 2);
    const col = index % 2;
    return { x: col * width, y: row * height, width, height };
  } else {
    // 5 browsers: 3 on top, 2 on bottom (centered)
    const width = Math.floor(screenWidth / 3);
    const height = Math.floor(screenHeight / 2);
    if (index < 3) {
      // Top row: 3 browsers
      return { x: index * width, y: 0, width, height };
    } else {
      // Bottom row: 2 browsers, centered
      const bottomOffset = Math.floor(width / 2);
      return { x: bottomOffset + (index - 3) * width, y: height, width, height };
    }
  }
}

module.exports = { calculateWindowLayout };
