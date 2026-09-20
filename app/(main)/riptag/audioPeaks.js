// Reducing decoded audio to the amplitude bars a waveform is drawn from.
//
// Shared by riptag's clip panel and /bandcamposter's trim panel so both
// waveforms are built the same way — and so the "far more bars than pixels"
// reasoning below lives in one place rather than being re-derived.

// Far more bars than a canvas has pixels: the draw pass reduces this to one
// column per pixel for whatever window is on screen, so zooming in surfaces
// real detail instead of stretching the same few hundred bars.
export const PEAK_BARS = 4000;

// Peak amplitude per bar, from one channel of decoded PCM.
export function computeAudioPeaks(data, bars = PEAK_BARS) {
  const block = Math.max(1, Math.floor(data.length / bars));
  const out = new Float32Array(bars);
  for (let i = 0; i < bars; i++) {
    let max = 0;
    const base = i * block;
    for (let j = 0; j < block && base + j < data.length; j++) {
      const v = Math.abs(data[base + j]);
      if (v > max) max = v;
    }
    out[i] = max;
  }
  return out;
}

// Decode at a low mono sample rate — the waveform only needs an envelope, and
// this keeps a long track's decoded buffer small. The buffer is dropped as
// soon as the bars are out of it.
export async function decodeToPeaks(arrayBuffer, { bars = PEAK_BARS, sampleRate = 8000 } = {}) {
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) throw new Error("This browser has no OfflineAudioContext.");
  const decoded = await new OfflineCtx(1, 1, sampleRate).decodeAudioData(arrayBuffer);
  return { peaks: computeAudioPeaks(decoded.getChannelData(0), bars), duration: decoded.duration };
}
