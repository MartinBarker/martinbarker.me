// Placement of the track-boundary handles drawn over RipTag's zoomed waveform.
//
// Every handle has a 22px drag bar at the top and an 18px play button under it.
// Two things made them disappear depending on the zoom level:
//  - Zoomed out, boundaries can sit closer together than a bar is wide (short
//    tracks, or the end/start pair either side of a silence gap), so their bars
//    and buttons were drawn exactly on top of one another.
//  - Near either edge of the view, a bar centred on its boundary was cut in
//    half by the waveform container's overflow: hidden.
// So handles that would touch are stacked into lanes, and a bar close to an
// edge is nudged inward while its boundary line stays where it really is.

export const BOUNDARY_BAR_HALF = 11;     // half of the 22px drag bar, the widest control
export const BOUNDARY_MIN_GAP = 24;      // bar width + 2px: any closer and two bars touch
export const BOUNDARY_LANE_STEP = 36;    // 12px bar + 2px + 18px play button + 4px
export const BOUNDARY_PLAY_OFFSET = 14;  // the play button sits this far below its bar

// How many lanes fit a waveform of the given height (always at least one).
export function maxBoundaryLanes(height) {
  const laneHeight = BOUNDARY_PLAY_OFFSET + 18; // top of the bar to the bottom of the button
  return Math.max(1, Math.floor((height - laneHeight) / BOUNDARY_LANE_STEP) + 1);
}

/**
 * Lays out boundary handles for the visible part of the waveform.
 *
 * @param {Array<{time: number}>} boundaries  anything with a time, in seconds
 * @param {{start: number, end: number, width: number, lanes?: number}} view
 *   the zoomview's visible time range and pixel width
 * @returns the boundaries whose line is on screen, left to right, each with
 *   x (the true line position), vx (where its bar and button are drawn) and lane
 */
export function layoutBoundaryHandles(boundaries, { start, end, width, lanes = 5 }) {
  const range = end - start;
  if (!(range > 0) || !(width > 0)) return [];
  const minVx = Math.min(BOUNDARY_BAR_HALF, width / 2);
  const maxVx = Math.max(width - BOUNDARY_BAR_HALF, width / 2);

  const placed = [];
  for (const boundary of boundaries) {
    const x = ((boundary.time - start) / range) * width;
    // Only boundaries whose line is actually on screen get a handle: a bar
    // for an off-screen line would point at nothing.
    if (x < -1 || x > width + 1) continue;
    placed.push({ ...boundary, x, vx: Math.min(Math.max(x, minVx), maxVx) });
  }
  placed.sort((p, q) => p.vx - q.vx);

  const laneLastVx = [];
  for (const p of placed) {
    // The top-most lane whose last bar is far enough to the left...
    let lane = laneLastVx.findIndex(last => p.vx - last >= BOUNDARY_MIN_GAP);
    if (lane === -1) {
      if (laneLastVx.length < lanes) {
        // ...otherwise a new lane below...
        lane = laneLastVx.length;
      } else {
        // ...or, once every lane is in use, the one whose last bar is
        // furthest left, which overlaps least.
        lane = 0;
        for (let k = 1; k < laneLastVx.length; k++) {
          if (laneLastVx[k] < laneLastVx[lane]) lane = k;
        }
      }
    }
    laneLastVx[lane] = p.vx;
    p.lane = lane;
  }
  return placed;
}
