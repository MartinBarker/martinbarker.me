// The YouTube icon (red rounded rectangle + white play triangle), unaltered,
// as the YouTube branding guidelines require when it marks YouTube features.
export default function YouTubeIcon({ height = 20, title = 'YouTube' }) {
  return (
    <svg viewBox="0 0 28 20" height={height} width={(height * 28) / 20} role="img" aria-label={title}>
      <path
        fill="#FF0000"
        d="M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5C28 14.7 28 10 28 10s0-4.7-.6-6.9z"
      />
      <path fill="#FFFFFF" d="M11.2 14.3 18.5 10l-7.3-4.3z" />
    </svg>
  );
}
