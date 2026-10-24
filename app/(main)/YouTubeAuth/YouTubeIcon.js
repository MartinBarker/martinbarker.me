/* eslint-disable @next/next/no-img-element */
// The official YouTube icon (full-color red), served unaltered from the pack at
// https://www.youtube.com/howyoutubeworks/resources/brand-resources/ — no
// redrawing, recoloring or cropping, per the branding guidelines.
//
// The PNG carries YouTube's own clear space around the glyph: the red shape is
// 579 of the image's 1075 px height. `height` sets the glyph's height, which the
// guidelines say must never be under 20dp, so the image is scaled up to match.
const GLYPH_RATIO = 579 / 1075;
const ASPECT = 1255 / 1075;
const MIN_GLYPH = 20;

export default function YouTubeIcon({ height = 24, title = 'YouTube' }) {
  const imgHeight = Math.ceil(Math.max(height, MIN_GLYPH) / GLYPH_RATIO);
  return (
    <img
      src="/images/youtube/yt_icon_red_digital.png"
      alt={title}
      height={imgHeight}
      width={Math.round(imgHeight * ASPECT)}
      style={{ display: 'block', flex: 'none' }}
    />
  );
}
