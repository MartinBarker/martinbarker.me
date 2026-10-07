// Bandcamp track and album pages.
//
// Of the three sources this is the only one that hands over audio: a public
// page streams an mp3-128 to anyone, and the URL for it sits in the page's own
// player data. Discogs and YouTube carry artwork and metadata only.

import {
  BROWSER_UA, decodeEntities, absolute, cleanTags, firstYear,
} from "../shared";

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

const metaContent = (html, prop) => {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
};

// An art_id names a square image on the CDN, where the numeric suffix picks a
// size. _0 is the original upload (often 1400px+ — worth having, since the
// poster is 1080 wide), _10 is a 1200px JPEG.
const artUrlsFor = (artId) => {
  if (!artId) return [];
  const id = String(artId).replace(/\D/g, "").padStart(10, "0");
  return [`https://f4.bcbits.com/img/a${id}_0.jpg`, `https://f4.bcbits.com/img/a${id}_10.jpg`];
};

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
  return cleanTags(raw);
}

export async function resolveBandcamp(pageUrl, { fail }) {
  let html;
  let landedOn = null;
  try {
    const res = await fetch(pageUrl.toString(), {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) {
      return fail(`Bandcamp returned ${res.status} for that page.`,
        res.status === 404 ? 404 : 502);
    }
    landedOn = res.url || null;
    html = await res.text();
  } catch (e) {
    return fail(`Couldn't reach Bandcamp: ${e.message}`, 502);
  }

  const rawTralbum = readDataAttr(html, "data-tralbum");
  if (!rawTralbum) {
    return fail("That page has no player data on it — is it a track or album page?", 422);
  }

  let tralbum;
  try {
    tralbum = JSON.parse(rawTralbum);
  } catch {
    return fail("Bandcamp's player data didn't parse — the page format may have changed.", 502);
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
    audioUrl: absolute(t.file?.["mp3-128"] || t.file?.["mp3-v0"] || null),
  }));

  const streamable = tracks.filter(t => t.audioUrl);
  if (!streamable.length) {
    return fail(
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
  const artUrls = artUrlsFor(artId);
  const ogImage = metaContent(html, "og:image");
  if (ogImage && !artUrls.includes(ogImage)) artUrls.push(ogImage);

  // The link people will paste somewhere: where the request actually landed
  // (Bandcamp redirects a renamed slug to its canonical one), minus any query
  // or fragment, which on a track page is only ever tracking noise.
  let canonicalUrl = `${pageUrl.origin}${pageUrl.pathname}`;
  if (landedOn) {
    try {
      const u = new URL(landedOn);
      if (u.hostname.toLowerCase().endsWith("bandcamp.com")) {
        canonicalUrl = `${u.origin}${u.pathname}`;
      }
    } catch { /* redirected somewhere unparseable — keep the vetted URL */ }
  }

  return {
    source: "bandcamp",
    pageUrl: canonicalUrl,
    kind: tralbum.item_type === "album" ? "album" : "track",
    title: tralbum.current?.title || "",
    artist: tralbum.artist || tralbum.current?.artist || "",
    label: band?.name || "",
    catno: "",
    year: firstYear(
      tralbum.current?.release_date,
      tralbum.album_release_date,
      tralbum.current?.publish_date,
    ),
    tags: readTags(html),
    // Every candidate is the same square cover at a different size, best first.
    art: artUrls.map((url, i) => ({ url: absolute(url), label: i === 0 ? "Cover (original)" : "Cover" })),
    tracks: streamable,
    videos: [],
    audioNote: "",
  };
}
