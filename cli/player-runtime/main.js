/* eslint-env browser */
/**
 * main.js — Startup: builds the racer filter, performs the initial
 * verified clip seek (Chrome/WebM seek retry logic), and kicks the
 * initial metadata pass for cache-fast loads.
 */

// --- Racer filter (3+ racers only) ---

buildRacerFilter();

// --- Initial clip seek ---

// Tolerance (seconds): if currentTime lands within this window of the target
// we consider the seek successful and stop retrying.
const SEEK_SNAP_TOLERANCE = 0.15;
// Maximum number of seeked-event retries before giving up on a snap-back seek.
const MAX_SEEK_RETRIES = 10;
// Positions within 1ms of zero are treated as "start of video" — no seek needed.
const ZERO_START_THRESHOLD = 0.001;

// seekAllWithVerify handles two distinct Chrome/WebM seeking failure modes:
//
//  1. Seek snaps back (seeked fires but currentTime < expected − tolerance):
//     Chrome can't find the target cluster without a seek table (Cues element).
//     Retry via the 'seeked' event up to MAX_SEEK_RETRIES times as data buffers.
//
//  2. Seek silently ignored at readyState=1 (HAVE_METADATA, no buffered data):
//     The seek is issued before any data is available, so Chrome drops it.
//     Retry via 'canplay' (readyState ≥ 3) when enough data has loaded.
//
// A single shared `seeks` counter caps the TOTAL number of currentTime writes at
// MAX_SEEK_RETRIES so the constant is a genuine hard ceiling. A dropped case-2
// seek fires no 'seeked' event, so it never consumes the budget — the counter is
// still ~0 when 'canplay' arrives, which is what previously motivated resetting
// it (and that reset, combined with two concurrently-live 'seeked' chains
// sharing one counter, made the effective maximum ambiguous).
function seekAllWithVerify(targetStart) {
  const adj = getAdjustedClipTimes();
  const ct = adj || clipTimes;
  seekAll(targetStart);
  raceVideos.forEach((v, i) => {
    if (!v || !clipTimes) return;
    const expected = ct && isValidClipEntry(ct[i]) ? ct[i].start : targetStart;
    if (expected <= ZERO_START_THRESHOLD) return; // nothing to verify at start of video
    let seeks = 0;
    const reseek = () => {
      if (Math.abs(v.currentTime - expected) > SEEK_SNAP_TOLERANCE && seeks < MAX_SEEK_RETRIES) {
        seeks++;
        v.currentTime = Math.min(expected, Number.isFinite(v.duration) ? v.duration : expected);
        v.addEventListener('seeked', reseek, { once: true });
      }
    };
    v.addEventListener('seeked', reseek, { once: true });
    // Case 2 fallback: once data is available (canplay = readyState ≥ 3), make a
    // fresh attempt if still off — within the same shared budget.
    v.addEventListener('canplay', reseek, { once: true });
  });
}

if (clipTimes) {
  const initSeek = () => {
    recalcActiveClip();
    seekAllWithVerify(activeClip ? activeClip.start : 0);
    scrubber.value = 0;
    updateTimeDisplay();
  };
  setPendingSeek(initSeek);
  if (raceVideos.every(v => !v || v.readyState >= 1)) {
    // If metadata loaded before listeners attached, run one onMeta() pass
    // explicitly so clip conversions/calibration are applied on first paint.
    onMeta();
  }
}

// Kick an initial metadata pass in case loadedmetadata fired before listeners
// were attached (e.g. cache-fast loads). Wait until all race videos expose
// metadata so conversion/calibration can actually run.
{
  let attempts = 0;
  const runInitialMetaPass = () => {
    if (raceVideos.every(v => !v || v.readyState >= 1)) {
      onMeta();
      return;
    }
    attempts++;
    if (attempts < 120) setTimeout(runInitialMetaPass, 50);
  };
  runInitialMetaPass();
}
