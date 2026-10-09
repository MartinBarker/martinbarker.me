// Places the first-pass track boundaries when the number of tracks is known
// (a Discogs tracklist or a typed track count).
//
// Dividing the audio into equal slices put almost every line in the middle of a
// song. Instead this looks for the quiet gaps *relative to the music around
// them*, not below one fixed dB threshold. Vinyl surface noise often sits above
// -35 dB, so a fixed threshold finds nothing, while a quiet passage inside a
// song can pass it. It then picks exactly count - 1 of those gaps, in order,
// each near where that track is expected to end. Discogs track lengths set
// those expected positions when every track has one; otherwise they're evenly
// spaced and matter less.

const HOP_SEC = 0.05;        // envelope resolution
const SMOOTH_WINDOWS = 7;    // ~350 ms moving median: ignores clicks and pops
const CONTEXT_SEC = 8;       // "how loud is the music around here"
const MIN_PROMINENCE_DB = 6; // a gap must be this much quieter than its surroundings
const RUN_SLACK_DB = 3;      // a gap spans the windows within this of its quietest point
const NMS_SEC = 2;           // at most one candidate gap per this many seconds

// "3:45" or "1:02:03" → seconds; null when missing or unparseable.
export function parseTrackDuration(str) {
  const parts = String(str || "").trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null;
  const secs = parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
  return secs > 0 ? secs : null;
}

// Loudness per hop in dB, median-smoothed.
function envelope(samples, sampleRate) {
  const hop = Math.max(1, Math.round(HOP_SEC * sampleRate));
  const n = Math.floor(samples.length / hop);
  const raw = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    const base = k * hop;
    for (let j = 0; j < hop; j++) { const v = samples[base + j]; sum += v * v; }
    raw[k] = 10 * Math.log10(sum / hop + 1e-12);
  }
  const half = Math.floor(SMOOTH_WINDOWS / 2);
  const smooth = new Float64Array(n);
  const buf = [];
  for (let k = 0; k < n; k++) {
    buf.length = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(n - 1, k + half); j++) buf.push(raw[j]);
    buf.sort((a, b) => a - b);
    smooth[k] = buf[buf.length >> 1];
  }
  return { smooth, hopSec: hop / sampleRate };
}

// Quiet gaps: local dips at least MIN_PROMINENCE_DB below the average level of
// the surrounding CONTEXT_SEC. Each has the time of its middle and a score in dB.
export function findGapCandidates(samples, sampleRate) {
  const { smooth, hopSec } = envelope(samples, sampleRate);
  const n = smooth.length;
  if (n < 3) return [];

  const prefix = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) prefix[k + 1] = prefix[k] + smooth[k];
  const ctx = Math.max(1, Math.round(CONTEXT_SEC / hopSec));

  const found = [];
  for (let k = 0; k < n; k++) {
    const v = smooth[k];
    if ((k > 0 && smooth[k - 1] < v) || (k < n - 1 && smooth[k + 1] < v)) continue; // not a local minimum
    const lo = Math.max(0, k - ctx), hi = Math.min(n, k + ctx + 1);
    const prominence = (prefix[hi] - prefix[lo]) / (hi - lo) - v;
    if (prominence < MIN_PROMINENCE_DB) continue;
    let a = k, b = k;
    while (a > 0 && smooth[a - 1] <= v + RUN_SLACK_DB) a--;
    while (b < n - 1 && smooth[b + 1] <= v + RUN_SLACK_DB) b++;
    const runSec = (b - a + 1) * hopSec;
    found.push({
      time: ((a + b + 1) / 2) * hopSec,
      start: a * hopSec,
      end: (b + 1) * hopSec,
      // Longer gaps are likelier to be between tracks than a brief dip in one.
      score: prominence + 3 * Math.log2(1 + runSec),
    });
  }

  // Keep the best candidate in any NMS_SEC stretch (a flat gap yields many minima).
  found.sort((p, q) => q.score - p.score);
  const kept = [];
  for (const c of found) {
    if (kept.every(k => Math.abs(k.time - c.time) >= NMS_SEC)) kept.push(c);
  }
  return kept.sort((p, q) => p.time - q.time);
}

/**
 * Chooses count - 1 split times.
 *
 * @param {Float32Array} samples  mono audio
 * @param {number} sampleRate
 * @param {number} count  number of tracks wanted
 * @param {{durations?: (number|null)[]}} opts  expected track lengths in seconds
 * @returns {{splits: number[], snapped: number, usedDurations: boolean}}
 */
export function findCountedSplits(samples, sampleRate, count, { durations } = {}) {
  const total = samples.length / sampleRate;
  const numSplits = Math.max(0, Math.floor(count) - 1);
  if (numSplits === 0 || !(total > 0)) return { splits: [], snapped: 0, usedDurations: false };

  // Expected boundary times. Discogs lengths rarely add up to the rip exactly
  // (lead-in, lead-out, run-out groove), so they're scaled to fit the file.
  const usedDurations = Array.isArray(durations) && durations.length === numSplits + 1
    && durations.every(d => d > 0);
  const ideal = [];
  if (usedDurations) {
    const sum = durations.reduce((s, d) => s + d, 0);
    let acc = 0;
    for (let k = 0; k < numSplits; k++) { acc += durations[k]; ideal.push((acc / sum) * total); }
  } else {
    for (let k = 0; k < numSplits; k++) ideal.push((total * (k + 1)) / (numSplits + 1));
  }

  // How far a split may drift from its expected time before the drift outweighs
  // a clear gap. Tight when real track lengths are known, loose for a guess.
  const avgLen = total / (numSplits + 1);
  const sigma = usedDurations ? Math.max(6, 0.12 * avgLen) : Math.max(10, 0.45 * avgLen);
  const DRIFT_WEIGHT = 6; // dB of gap score that one sigma of drift costs
  const minGap = Math.min(3, avgLen / 4);

  const candidates = findGapCandidates(samples, sampleRate)
    .filter(c => c.time > minGap && c.time < total - minGap);

  // Per split: nearby gaps, plus falling back to the expected time (cost 0),
  // so a split with no convincing gap stays where it was expected.
  const options = ideal.map(t => {
    const opts = [{ time: t, cost: 0, snapped: false }];
    for (const c of candidates) {
      const z = (c.time - t) / sigma;
      if (Math.abs(z) > 3) continue;
      const cost = DRIFT_WEIGHT * z * z - c.score;
      if (cost < 0) opts.push({ time: c.time, cost, snapped: true });
    }
    return opts.sort((p, q) => p.time - q.time);
  });

  // Cheapest strictly increasing choice, one option per split (dynamic programming).
  const best = options.map(o => o.map(() => ({ cost: Infinity, prev: -1 })));
  options[0].forEach((o, i) => { best[0][i].cost = o.cost; });
  for (let k = 1; k < numSplits; k++) {
    options[k].forEach((o, i) => {
      options[k - 1].forEach((p, j) => {
        if (o.time - p.time < minGap) return;
        const c = best[k - 1][j].cost + o.cost;
        if (c < best[k][i].cost) best[k][i] = { cost: c, prev: j };
      });
    });
  }
  let end = -1;
  best[numSplits - 1].forEach((b, i) => { if (end === -1 || b.cost < best[numSplits - 1][end].cost) end = i; });
  if (end === -1 || !Number.isFinite(best[numSplits - 1][end].cost)) {
    return { splits: ideal, snapped: 0, usedDurations };
  }
  const chosen = [];
  for (let k = numSplits - 1, i = end; k >= 0; i = best[k][i].prev, k--) chosen.unshift(options[k][i]);
  return {
    splits: chosen.map(o => o.time),
    snapped: chosen.filter(o => o.snapped).length,
    usedDurations,
  };
}
