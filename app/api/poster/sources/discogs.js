// Discogs releases and masters, through the public API.
//
// Artwork and metadata only. The "videos" a release carries are YouTube links,
// so there is no audio here that this server could legitimately hand over —
// see audioNote below, which the page turns into an explanation and a prompt
// for a local file.

import { DISCOGS_UA, cleanTags, firstYear } from "../shared";
import { youTubeIdFrom, thumbnailCandidates } from "./youtube";

const API = "https://api.discogs.com";

// /release/249504-Some-Slug, /master/13158-..., and the locale-prefixed
// variants Discogs redirects to (/fr/release/..., /ja/master/...).
const ID_RE = /(?:^|\/)(release|master)\/(\d+)/;

export function discogsRefFrom(pageUrl) {
  const m = ID_RE.exec(pageUrl.pathname);
  return m ? { kind: m[1], id: m[2] } : null;
}

// Key/secret rather than OAuth: this is an unattributed read of public data,
// and it is what unlocks the `images` array (an unauthenticated call simply
// omits it). Missing credentials are survivable — metadata and videos still
// come back, so the page says what is missing instead of failing outright.
function authHeader() {
  const key = process.env.DISCOGS_CONSUMER_KEY;
  const secret = process.env.DISCOGS_CONSUMER_SECRET;
  if (!key || !secret) return null;
  return `Discogs key=${key}, secret=${secret}`;
}

const joinNames = (list) => (list || [])
  .map(a => String(a.name || "").replace(/\s*\(\d+\)$/, ""))   // Discogs disambiguates dupes as "Name (2)"
  .filter(Boolean)
  .join(", ");

export async function resolveDiscogs(pageUrl, { fail }) {
  const ref = discogsRefFrom(pageUrl);
  if (!ref) {
    return fail("That Discogs link isn't a release or master page.", 422);
  }

  const auth = authHeader();
  const headers = { "User-Agent": DISCOGS_UA, Accept: "application/json" };
  if (auth) headers.Authorization = auth;

  let data;
  try {
    const res = await fetch(`${API}/${ref.kind}s/${ref.id}`, {
      headers, redirect: "follow", cache: "no-store",
    });
    if (res.status === 404) return fail("Discogs has no such release or master.", 404);
    if (res.status === 429) {
      return fail("Discogs is rate-limiting this server right now — try again shortly.", 429);
    }
    if (!res.ok) return fail(`Discogs returned ${res.status} for that page.`, 502);
    data = await res.json();
  } catch (e) {
    return fail(`Couldn't reach Discogs: ${e.message}`, 502);
  }

  // A master has no labels of its own; those live on each release under it.
  const label = (data.labels || [])[0] || {};

  // Primary art first, then the rest — a release often has front, back, label
  // scans and inserts, and the front is usually what a poster wants.
  const images = (data.images || []).slice();
  images.sort((a, b) => (a.type === "primary" ? -1 : 0) - (b.type === "primary" ? -1 : 0));
  const art = images.map((im, i) => ({
    url: im.uri,
    width: im.width,
    height: im.height,
    label: im.type === "primary" ? "Front cover" : `Image ${i + 1}`,
  }));

  const videos = (data.videos || []).map(v => {
    const id = youTubeIdFrom(v.uri);
    return {
      url: v.uri,
      id,
      title: v.title || "",
      duration: Number(v.duration) || 0,
      // A video's thumbnail is a usable poster image in its own right when a
      // release has no scans attached.
      thumb: id ? thumbnailCandidates(id)[0] : null,
    };
  }).filter(v => v.id);

  // Every video thumbnail is also an artwork candidate, after the real scans.
  for (const v of videos) {
    if (v.thumb && !art.some(a => a.url === v.thumb)) {
      art.push({ url: v.thumb, label: `Video thumbnail — ${v.title}`.slice(0, 60) });
    }
  }

  const audioNote = !art.length && !auth
    ? "This server has no Discogs API credentials, so Discogs withheld the artwork. Metadata and videos still work."
    : "";

  return {
    source: "discogs",
    pageUrl: `https://www.discogs.com/${ref.kind}/${ref.id}`,
    kind: ref.kind,
    title: data.title || "",
    artist: joinNames(data.artists),
    label: label.name || "",
    catno: label.catno || "",
    year: firstYear(data.released, data.year),
    // Genres and styles together: "Electronic" plus "Euro-Disco" describes a
    // record far better than either alone.
    tags: cleanTags([...(data.genres || []), ...(data.styles || [])]),
    art,
    // Discogs knows the tracklist but not where to hear it, so these carry no
    // audio URL. Positions are strings there ("A1", "B2"), not numbers.
    tracks: (data.tracklist || [])
      .filter(t => !t.type_ || t.type_ === "track")
      .map((t, i) => ({
        index: i,
        num: t.position || String(i + 1),
        title: t.title || `Track ${i + 1}`,
        duration: 0,
        audioUrl: null,
      })),
    videos,
    audioNote: audioNote
      || "Discogs holds artwork and metadata, not audio — its “videos” are YouTube links. Choose an audio file below.",
  };
}
