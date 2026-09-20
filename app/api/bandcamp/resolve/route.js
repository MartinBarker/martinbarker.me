// Reads a Bandcamp track or album page and reports what the poster renderer
// needs from it: the track list, each track's stream URL, and the cover art.
//
// This has to happen server-side. Bandcamp sends no Access-Control-Allow-Origin
// header, so a browser fetch of the page (or of the media it points at) is
// blocked before it starts.

import { parseBandcampPageUrl, BROWSER_UA, jsonError } from "../shared";

export const dynamic = "force-dynamic";   // never cache a lookup
export const runtime = "nodejs";

// Bandcamp embeds its page data as HTML attributes on a <script> tag:
//   <script type="text/javascript" data-tralbum="{&quot;...&quot;}" data-band="...">
// The value is one JSON object, HTML-escaped. Pulling it out by attribute is
// far steadier than scraping the rendered markup, which changes often.
function readDataAttr(html, name) {
  const at = html.indexOf(`${name}="`);
  if (at === -1) return null;
  const start = at + name.length + 2;
  const end = html.indexOf('"', start);
  if (end === -1) return null;
  return decodeEntities(html.slice(start, end));
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");   // last, so "&amp;quot;" doesn't become a quote
}

const metaContent = (html, prop) => {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
};

// Artwork: an art_id names a square image on the CDN, where the numeric suffix
// picks a size. _0 is the original upload (often 1400px+ — worth having, since
// the poster is 1080 wide), _10 is a 1200px JPEG. The page's og:image is the
// fallback when there is no art_id.
const artUrlsFor = (artId) => {
  if (!artId) return [];
  const id = String(artId).replace(/\D/g, "").padStart(10, "0");
  return [`https://f4.bcbits.com/img/a${id}_0.jpg`, `https://f4.bcbits.com/img/a${id}_10.jpg`];
};

// Enough genre tags to describe a release; past this a hashtag line stops
// being readable and starts being spam.
const MAX_TAGS = 10;

// The genre tags shown on the page. The ld+json block carries them as the
// artist actually typed them ("Electronic", "New York"); the rendered
// <a class="tag"> links hold the same list lowercased, so they are a fallback
// for a page shaped differently rather than the first choice.
function readTags(html) {
  const raw = [];
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (ld) {
    try {
      const j = JSON.parse(ld[1]);
      if (Array.isArray(j.keywords)) raw.push(...j.keywords);
      else if (typeof j.keywords === "string") raw.push(...j.keywords.split(","));
    } catch { /* fall through to the markup */ }
  }
  if (!raw.length) {
    for (const m of html.matchAll(/<a[^>]*class="tag"[^>]*>([^<]+)<\/a>/g)) raw.push(m[1]);
  }

  const seen = new Set();
  const tags = [];
  for (const entry of raw) {
    const tag = decodeEntities(String(entry)).trim();
    if (!tag) continue;
    // Case-insensitively, so a page listing both "Electronic" and "electronic"
    // doesn't produce the same hashtag twice.
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

// The first 4-digit year out of the candidates, in preference order.
// `release_date` is null on plenty of singles, so it can't be the only source.
const firstYear = (...values) => {
  for (const v of values) {
    const m = /\b(\d{4})\b/.exec(String(v || ""));
    if (m) return m[1];
  }
  return "";
};

export async function GET(request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return jsonError("Pass a Bandcamp track or album URL as ?url=");

  let pageUrl;
  try {
    pageUrl = parseBandcampPageUrl(raw);
  } catch (e) {
    return jsonError(e.message);
  }

  let html;
  let landedOn = null;
  try {
    const res = await fetch(pageUrl.toString(), {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) {
      return jsonError(`Bandcamp returned ${res.status} for that page.`,
        res.status === 404 ? 404 : 502);
    }
    landedOn = res.url || null;
    html = await res.text();
  } catch (e) {
    return jsonError(`Couldn't reach Bandcamp: ${e.message}`, 502);
  }

  // The link people will paste somewhere: where the request actually landed
  // (Bandcamp redirects a renamed slug to its canonical one), minus any query
  // or fragment, which on a track page is only ever tracking noise.
  // A redirect that left bandcamp.com is not something to present as the
  // Bandcamp link, so the vetted input URL wins in that case.
  let canonicalUrl = `${pageUrl.origin}${pageUrl.pathname}`;
  if (landedOn) {
    try {
      const u = parseBandcampPageUrl(landedOn);
      canonicalUrl = `${u.origin}${u.pathname}`;
    } catch { /* redirected off bandcamp.com — keep the URL we vetted */ }
  }

  const rawTralbum = readDataAttr(html, "data-tralbum");
  if (!rawTralbum) {
    return jsonError(
      "That page has no player data on it — is it a track or album page?", 422);
  }

  let tralbum;
  try {
    tralbum = JSON.parse(rawTralbum);
  } catch {
    return jsonError("Bandcamp's player data didn't parse — the page format may have changed.", 502);
  }

  // `trackinfo` is present on both track and album pages; a track page just has
  // one entry. A track with no `file` is one Bandcamp won't stream (a
  // pre-order, or a purchase-only bonus), so it can't feed a render.
  const tracks = (tralbum.trackinfo || []).map((t, i) => ({
    index: i,
    num: t.track_num || i + 1,
    title: t.title || `Track ${i + 1}`,
    duration: Number(t.duration) || 0,
    // mp3-128 is what a Bandcamp page streams to anyone; it is the only
    // encoding a public page exposes.
    audioUrl: t.file?.["mp3-128"] || t.file?.["mp3-v0"] || null,
  }));

  const streamable = tracks.filter(t => t.audioUrl);
  if (!streamable.length) {
    return jsonError(
      "No streamable audio on that page — Bandcamp only exposes a stream for tracks it will play publicly.",
      422);
  }

  // `data-band` is the page's owner — the label on a label page, the musician
  // on their own. Bandcamp has no separate label field, so this is the closest
  // thing to one, and on an artist page it simply repeats the artist.
  let band = null;
  try {
    const rawBand = readDataAttr(html, "data-band");
    if (rawBand) band = JSON.parse(rawBand);
  } catch { /* the blurb just loses its label line */ }

  const artId = tralbum.current?.art_id ?? tralbum.art_id;
  const artCandidates = artUrlsFor(artId);
  const ogImage = metaContent(html, "og:image");
  if (ogImage && !artCandidates.includes(ogImage)) artCandidates.push(ogImage);

  // Bandcamp's own "//" protocol-relative stream URLs break `new URL()` on the
  // client, so they are normalised here rather than in three places there.
  const absolute = (u) => (u && u.startsWith("//") ? `https:${u}` : u);

  // Nothing here is written down anywhere: the page is fetched with no-store,
  // parsed in memory, and the result is marked no-store on the way out so no
  // browser or proxy between here and the user keeps a copy either.
  return Response.json({
    pageUrl: canonicalUrl,
    kind: tralbum.item_type === "album" ? "album" : "track",
    artist: tralbum.artist || tralbum.current?.artist || "",
    albumTitle: tralbum.current?.title || "",
    label: band?.name || "",
    tags: readTags(html),
    year: firstYear(
      tralbum.current?.release_date,
      tralbum.album_release_date,
      tralbum.current?.publish_date,
    ),
    art: artCandidates.map(absolute),
    tracks: streamable.map(t => ({ ...t, audioUrl: absolute(t.audioUrl) })),
  }, { headers: { "Cache-Control": "no-store" } });
}
