/* eslint-env browser */
/**
 * zip.cjs — Pure CRC32 and minimal ZIP (store-only) builder used by the
 * self-contained HTML export.
 *
 * DOM independent so Node can require() it for unit tests (TextEncoder,
 * DataView, and Blob are Node globals); in the browser build the guarded
 * module.exports is a no-op.
 */

// --- Export HTML: self-contained zip with videos, profiles, baked adjustments ---

const _crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  _crc32Table[i] = c;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = _crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZipBuilder() {
  const chunks = [];
  const entries = [];
  const encoder = new TextEncoder();
  let offset = 0;

  function addFile(name, data) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    let pos = 0;
    view.setUint32(pos, 0x04034b50, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2;
    view.setUint16(pos, 0x0800, true); pos += 2; // UTF-8 flag
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0x5421, true); pos += 2;
    view.setUint32(pos, crc, true); pos += 4;
    view.setUint32(pos, data.length, true); pos += 4;
    view.setUint32(pos, data.length, true); pos += 4;
    view.setUint16(pos, nameBytes.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    localHeader.set(nameBytes, pos);

    chunks.push(localHeader, data);
    entries.push({ name: nameBytes, size: data.length, crc, offset });
    offset += localHeader.length + data.length;
  }

  function toBlob() {
    const centralDirOffset = offset;
    let centralDirSize = 0;
    entries.forEach(e => { centralDirSize += 46 + e.name.length; });

    const trailerChunks = [];
    for (const e of entries) {
      const centralHeader = new Uint8Array(46 + e.name.length);
      const view = new DataView(centralHeader.buffer);
      let pos = 0;
      view.setUint32(pos, 0x02014b50, true); pos += 4;
      view.setUint16(pos, 20, true); pos += 2;
      view.setUint16(pos, 20, true); pos += 2;
      view.setUint16(pos, 0x0800, true); pos += 2; // UTF-8 flag
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0x5421, true); pos += 2;
      view.setUint32(pos, e.crc, true); pos += 4;
      view.setUint32(pos, e.size, true); pos += 4;
      view.setUint32(pos, e.size, true); pos += 4;
      view.setUint16(pos, e.name.length, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint16(pos, 0, true); pos += 2;
      view.setUint32(pos, 0, true); pos += 4;
      view.setUint32(pos, e.offset, true); pos += 4;
      centralHeader.set(e.name, pos);
      trailerChunks.push(centralHeader);
    }

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    let p = 0;
    eocdView.setUint32(p, 0x06054b50, true); p += 4;
    eocdView.setUint16(p, 0, true); p += 2;
    eocdView.setUint16(p, 0, true); p += 2;
    eocdView.setUint16(p, entries.length, true); p += 2;
    eocdView.setUint16(p, entries.length, true); p += 2;
    eocdView.setUint32(p, centralDirSize, true); p += 4;
    eocdView.setUint32(p, centralDirOffset, true); p += 4;
    eocdView.setUint16(p, 0, true);
    trailerChunks.push(eocd);

    // Build zip from chunks to avoid creating one giant contiguous ArrayBuffer copy.
    return new Blob([...chunks, ...trailerChunks], { type: 'application/zip' });
  }

  return { addFile, toBlob };
}

// Node export for unit tests — a no-op in the browser build, where `module` is undefined.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { crc32, createZipBuilder };
}
