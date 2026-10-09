// YouTube videos, through the public oEmbed endpoint.
//
// Title, channel and thumbnail only. Pulling an audio or video stream out of
// YouTube means working around its delivery controls, which its Terms of
// Service prohibit, so this source deliberately stops at the thumbnail and the
// page tells the user to supply their own audio file.

import { BROWSER_UA, cleanTags } from "../shared";

// watch?v=, youtu.be/, /shorts/, /embed/, /live/, and music.youtube.com — all
// of which carry the same 11-character id.
const ID_PATTERNS = [
  /[?&]v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /\/shorts\/([A-Za-z0-9_-]{11})/,
  /\/embed\/([A-Za-z0-9_-]{11})/,
  /\/live\/([A-Za-z0-9_-]{11})/,
];

export function youTubeIdFrom(raw) {
  const s = String(raw || "");
  for (const re of ID_PATTERNS) {
    const m = re.exec(s);
    if (m) return m[1];
  }
  return null;
}

// Biggest first. maxresdefault only exists when the uploader's source was at
// least 1280x720, so it 404s often enough that the page has to try in order
// rather than trusting the first URL.
export const thumbnailCandidates = (id) => [
  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
  `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
];

export async function resolveYouTube(pageUrl, { fail }) {
  const id = youTubeIdFrom(pageUrl.toString());
  if (!id) return fail("That YouTube link has no video id in it.", 422);

  const watchUrl = `https://www.youtube.com/watch?v=${id}`;

  // oEmbed is YouTube's own published endpoint for exactly this: the title,
  // the channel and a thumbnail, with no API key and no scraping.
  let meta = {};
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`,
      { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      return fail("That video is private or embedding is disabled, so its details aren't readable.", 422);
    }
    if (res.status === 404) return fail("YouTube has no such video.", 404);
    if (!res.ok) return fail(`YouTube returned ${res.status} for that video.`, 502);
    meta = await res.json();
  } catch (e) {
    return fail(`Couldn't reach YouTube: ${e.message}`, 502);
  }

  // Uploads are titled "Artist - Title" often enough to be worth splitting,
  // but only on a real separator with text either side; anything else stays
  // whole and the channel stands in as the artist.
  const rawTitle = String(meta.title || "");
  const split = /^(.{1,80}?)\s+[-–—]\s+(.+)$/.exec(rawTitle);
  const artist = split ? split[1].trim() : (meta.author_name || "");
  const title = split ? split[2].trim() : rawTitle;

  const thumbs = thumbnailCandidates(id);
  if (meta.thumbnail_url && !thumbs.includes(meta.thumbnail_url)) thumbs.push(meta.thumbnail_url);

  return {
    source: "youtube",
    pageUrl: watchUrl,
    kind: "video",
    title,
    artist,
    label: meta.author_name || "",
    catno: "",
    year: "",
    tags: cleanTags([]),
    // Tried in order by the page: the first that actually exists wins.
    art: thumbs.map((url, i) => ({
      url,
      label: i === 0 ? "Thumbnail (max)" : "Thumbnail",
    })),
    tracks: [{ index: 0, num: 1, title, duration: 0, audioUrl: null }],
    videos: [{ url: watchUrl, id, title: rawTitle, duration: 0, thumb: thumbs[0] }],
    audioNote:
      "YouTube doesn't permit downloading a video's audio, so this page reads the "
      + "title and thumbnail only. Choose an audio file below.",
  };
}
