// Pulling colours out of the cover art, in the browser.
//
// node-vibrant is a dependency of this repo, but the /vibrant page runs it
// server-side (`node-vibrant/node`) behind an API call. The cover here is
// already decoded into an <img> on the page, and the eyedropper needs raw
// pixels regardless — so one small canvas read serves both the palette and the
// picker, with no round trip and nothing new in the bundle.

export const toHex = (r, g, b) =>
  "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, "0")).join("");

// Straight RGB distance. Not perceptually uniform, but it only has to answer
// "are these two swatches obviously different", which it does well enough.
const distance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

// Relative luminance, for deciding whether a swatch needs a light or dark
// outline so a near-white one is still visible against the panel.
export const isLight = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 160;
};

// The most-used colours in the image, most common first.
export function extractPalette(img, count = 6) {
  const S = 96;   // the art is square; this is plenty to count colours by
  const canvas = document.createElement("canvas");
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);

  let data;
  try {
    ({ data } = ctx.getImageData(0, 0, S, S));
  } catch {
    // Only happens if the canvas is tainted, which it shouldn't be — the art
    // arrives same-origin through the proxy and is loaded from a blob URL.
    return [];
  }

  // 4 bits per channel: fine enough to keep distinct colours apart, coarse
  // enough that a gradient doesn't shatter into hundreds of one-pixel buckets.
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;   // ignore transparent pixels
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let e = buckets.get(key);
    if (!e) buckets.set(key, e = { n: 0, r: 0, g: 0, b: 0 });
    e.n++; e.r += r; e.g += g; e.b += b;
  }

  const ranked = [...buckets.values()]
    .map(e => ({ n: e.n, r: e.r / e.n, g: e.g / e.n, b: e.b / e.n }))
    .sort((a, b) => b.n - a.n);

  // Spread the picks out, or a photograph returns six shades of one brown.
  const MIN_DISTANCE = 56;
  const picked = [];
  for (const cand of ranked) {
    if (picked.length >= count) break;
    if (picked.every(p => distance(p, cand) >= MIN_DISTANCE)) picked.push(cand);
  }
  // A genuinely monochrome cover can't fill the row that way; top up by
  // frequency rather than showing two swatches.
  for (const cand of ranked) {
    if (picked.length >= count) break;
    if (!picked.includes(cand)) picked.push(cand);
  }

  return picked.map(p => toHex(p.r, p.g, p.b));
}
