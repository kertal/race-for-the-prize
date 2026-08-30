/* eslint-env browser */
/**
 * export-layout.cjs — Pure side-by-side export layout math.
 *
 * Side-effect free and DOM independent so Node can require() it for unit
 * tests; in the browser build the guarded module.exports is a no-op.
 * getExportLayout (export-video.js) supplies count and aspect from the
 * live video elements.
 */

function computeExportLayout(count, aspect) {
  const LABEL_H = 30;
  const targetW = count <= 3 ? 640 : 480;
  const cellH = Math.round(targetW * aspect);
  const slotH = cellH + LABEL_H;
  let cols, rows;
  const positions = [];
  if (count <= 3) {
    cols = count; rows = 1;
    for (let i = 0; i < count; i++) positions.push({ x: i * targetW, y: 0 });
  } else if (count === 4) {
    cols = 2; rows = 2;
    for (let i = 0; i < 4; i++) positions.push({ x: (i % 2) * targetW, y: Math.floor(i / 2) * slotH });
  } else {
    cols = 3; rows = 2;
    for (let i = 0; i < 3; i++) positions.push({ x: i * targetW, y: 0 });
    const bottomOffset = Math.floor(targetW / 2);
    for (let i = 0; i < count - 3; i++) positions.push({ x: bottomOffset + i * targetW, y: slotH });
  }
  const canvasW = (count >= 5 ? 3 : cols) * targetW;
  const rawH = rows * slotH;
  // libx264 (MOV) requires even dimensions; bump odd height by 1
  const canvasH = rawH + (rawH % 2);
  return { canvasW, canvasH, targetW, cellH, labelH: LABEL_H, positions };
}

// Node export for unit tests — a no-op in the browser build, where `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeExportLayout };
}
