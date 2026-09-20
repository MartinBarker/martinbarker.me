// The look of a rendered frame: how an image is fitted into the output, how
// hard its blurred backdrop is blurred, and how that backdrop drifts.
//
// This lived inside riptag/page.js until /bandcamposter needed the same frame.
// Two copies of these numbers would have drifted the moment either page was
// tuned, so both import them from here instead — the blur radius, the drift
// travel and the still frame rate are now defined exactly once.

// ---- Background blur ----
// Strength runs 0-100+, expressed as a share of the frame *width* so a 4K
// render and a 720p one are blurred the same amount relative to the picture
// rather than in raw pixels. 100 is the look the render has always had, kept
// as the reference point so an existing project is unchanged; the scale runs
// past it because that turned out not to be blurry enough for a backdrop.
export const BG_BLUR_DEFAULT = 175;
export const BG_BLUR_MAX = 400;
export const BG_BLUR_MAX_SIGMA_PCT = 0.027;
// Repeated box passes approximate a Gaussian; three is where it stops being
// visibly boxy. The old expression used twenty, which is ~7x the work for no
// visible difference — the radius below is scaled to match its blur strength
// (sigma ~= radius * sqrt(passes / 3)), so the picture is unchanged.
export const BG_BLUR_PASSES = 3;

export const clampBgBlur = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(BG_BLUR_MAX, Math.round(n))) : BG_BLUR_DEFAULT;
};

// The boxblur clause for a frame `width` px wide, or "" when blur is off.
export const bgBlurFilter = (width, blurPct) => {
  const pct = clampBgBlur(blurPct);
  if (pct === 0) return "";
  // Past roughly a quarter of the frame the kernel is wider than the picture,
  // so a bigger radius costs time without looking any softer.
  const radius = Math.max(1, Math.min(
    Math.round(width / 4),
    Math.round(width * BG_BLUR_MAX_SIGMA_PCT * (pct / 100)),
  ));
  return `,boxblur=${radius}:${BG_BLUR_PASSES}`;
};

// The same blur strength as a CSS `blur()` radius, for an on-page preview of a
// box `h` px tall. Keeps the preview and the encode in step.
export const bgBlurPreviewPx = (h, blurPct) =>
  Math.max(1, Math.round(h * 0.011 * (clampBgBlur(blurPct) / 100)));

// ---- Background drift ----
export const BG_DRIFT_ZOOM = 1.2;     // blur bg is scaled this much larger so it has room to drift
export const BG_DRIFT_AMOUNT = 0.06;  // drift travel, as a fraction of the output size
export const BG_DRIFT_PERIOD = 24;    // seconds for one full drift cycle

// ---- Foreground motion (Ken Burns) ----
export const MOTION_ZOOM = 1.25;      // how far zoom/pan moves (1.25 = 25%)
// Speed is relative to the image's own on-screen time: 1x sweeps the full
// travel exactly once across the segment, 2x sweeps out and back, 0.5x covers
// half of it.
export const MOTION_SPEED_MIN = 0.25;
export const MOTION_SPEED_MAX = 4;
export const MOTION_SPEED_STEP = 0.25;
export const clampMotionSpeed = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return 1;
  return Math.min(MOTION_SPEED_MAX, Math.max(MOTION_SPEED_MIN, n));
};

export const STILL_FPS = 2;           // frame rate for motionless slideshows

// ---- Shared filter fragments ----
// Scale-and-blur a source to cover `tw`x`th`. At STILL_FPS a full-res box blur
// is affordable; at a real frame rate it is crushing, so motion renders blur a
// ~480p copy and scale it back up — through a blur this heavy the difference
// isn't visible, and both paths take their radius from the same percentage.
export const blurCoverFilter = (tw, th, blurPct, fps) => (fps === STILL_FPS
  ? `scale=w=${tw}:h=${th}:force_original_aspect_ratio=increase${bgBlurFilter(tw, blurPct)}`
  : `scale=w=480:h=270:force_original_aspect_ratio=increase${bgBlurFilter(480, blurPct)},scale=w=${tw}:h=${th}:force_original_aspect_ratio=increase`);

// A blurred backdrop filling `w`x`h`, drifting on a slow circle when asked.
// `src` is the labelled input it reads from, e.g. "[0:v]fps=24,".
export function blurBackdropChain(src, w, h, blurPct, fps, { drift = false, driftSpeed = 1 } = {}) {
  if (!drift) {
    return `${src}${blurCoverFilter(w, h, blurPct, fps)},`
      + `crop=${w}:${h}:(iw-${w})/2:(ih-${h})/2,setsar=1`;
  }
  // Oversized so there is room to drift, then a slowly circling crop. Travel is
  // capped in pixels (not as a share of the slack) so the drift stays equally
  // gentle whatever the source image's aspect is.
  const bw = Math.round(w * BG_DRIFT_ZOOM), bh = Math.round(h * BG_DRIFT_ZOOM);
  const ax = Math.round(w * BG_DRIFT_AMOUNT), ay = Math.round(h * BG_DRIFT_AMOUNT);
  const p = (BG_DRIFT_PERIOD / clampMotionSpeed(driftSpeed)).toFixed(2);
  // crop has no `eval` option — its x/y expressions are already re-evaluated
  // for every frame, and `t` is available there.
  return `${src}${blurCoverFilter(bw, bh, blurPct, fps)},`
    + `crop=w=${w}:h=${h}:x='(iw-ow)/2+min((iw-ow)/2,${ax})*sin(2*PI*t/${p})':y='(ih-oh)/2+min((ih-oh)/2,${ay})*cos(2*PI*t/${p})',setsar=1`;
}

// h264 needs even dimensions; every render path clamps the same way.
export const RENDER_MAX_DIM = 7680;
export const evenDimension = (n) => {
  const v = Math.min(RENDER_MAX_DIM, Math.max(2, Math.round(n)));
  return Math.max(2, Math.floor(v / 2) * 2);
};

// A Ken Burns move over a composed `w`x`h` frame, as a filter fragment ending
// in a comma (or "" for no motion). The source is pre-scaled larger so zoompan
// has pixels to crop into, and `d=1` makes it emit one frame per input frame,
// so `on` counts output frames within this segment.
export function motionZoompanFilter({ motion, frames, speed, w, h, fps }) {
  if (!motion || motion === "none") return "";
  const z = MOTION_ZOOM;
  const sw = Math.round(w * z / 2) * 2, sh = Math.round(h * z / 2) * 2;
  const last = Math.max(1, frames - 1);
  // Frames per one-way sweep. At 1x that's the whole segment (so the move
  // finishes exactly as the image leaves); faster speeds sweep out and back,
  // slower ones only get partway. `p` is a 0->1->0 triangle over it.
  const sweep = Math.max(1, Math.round(last / clampMotionSpeed(speed)));
  const p = `abs(mod(on/${sweep}+1,2)-1)`;
  const cx = "iw/2-(iw/zoom/2)", cy = "ih/2-(ih/zoom/2)";
  const d = (z - 1).toFixed(5);
  let zExpr = String(z), xExpr = cx, yExpr = cy;
  if (motion === "zoom-in") zExpr = `1+${d}*${p}`;
  else if (motion === "zoom-out") zExpr = `${z}-${d}*${p}`;
  else if (motion === "pan-right") xExpr = `(iw-iw/zoom)*${p}`;
  else if (motion === "pan-left") xExpr = `(iw-iw/zoom)*(1-${p})`;
  else if (motion === "pan-down") yExpr = `(ih-ih/zoom)*${p}`;
  else if (motion === "pan-up") yExpr = `(ih-ih/zoom)*(1-${p})`;
  return `scale=w=${sw}:h=${sh},zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${w}x${h}:fps=${fps},`;
}

// The motion choices offered by both pages.
export const IMAGE_MOTIONS = [
  { value: "none",      label: "Still (no motion)", short: "still" },
  { value: "zoom-in",   label: "Zoom in",           short: "zoom in" },
  { value: "zoom-out",  label: "Zoom out",          short: "zoom out" },
  { value: "pan-right", label: "Pan left → right",  short: "pan →" },
  { value: "pan-left",  label: "Pan right → left",  short: "pan ←" },
  { value: "pan-down",  label: "Pan top → bottom",  short: "pan ↓" },
  { value: "pan-up",    label: "Pan bottom → top",  short: "pan ↑" },
];
export const BG_MOTIONS = [
  { value: "none",  label: "Static blur", short: "static bg" },
  { value: "drift", label: "Slow drift",  short: "drifting bg" },
];
