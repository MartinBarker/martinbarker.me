// Shared guards and helpers for the /api/poster handlers.
//
// Every handler here takes a URL from the browser and fetches it server-side,
// which is a request-forgery hole unless the host is checked first: without an
// allowlist, `?url=http://169.254.169.254/...` would hand the caller the
// instance metadata of whatever box this is deployed on. So each purpose
// accepts only the hosts it actually needs.

// Pages we will read and parse.
const PAGE_HOSTS = ["bandcamp.com", "discogs.com", "youtube.com", "youtu.be", "music.youtube.com"];
// CDNs we will stream bytes from: Bandcamp audio/art, Discogs art, YouTube thumbnails.
const MEDIA_HOSTS = ["bcbits.com", "discogs.com", "ytimg.com", "youtube.com"];

const hostMatches = (host, suffixes) =>
  suffixes.some(s => host === s || host.endsWith(`.${s}`));

function parseAllowed(raw, suffixes, what) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    throw new Error("That doesn't look like a URL.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  if (!hostMatches(u.hostname.toLowerCase(), suffixes)) {
    throw new Error(`${what} (got ${u.hostname}).`);
  }
  return u;
}

export const parsePageUrl = (raw) =>
  parseAllowed(raw, PAGE_HOSTS, "Paste a Bandcamp, Discogs or YouTube link");

export const parseMediaUrl = (raw) =>
  parseAllowed(raw, MEDIA_HOSTS, "Only Bandcamp, Discogs and YouTube media URLs are supported");

// Which source a pasted link belongs to, or null if it is none of them.
export function detectSource(url) {
  const h = url.hostname.toLowerCase();
  if (hostMatches(h, ["bandcamp.com"])) return "bandcamp";
  if (hostMatches(h, ["discogs.com"])) return "discogs";
  if (hostMatches(h, ["youtube.com", "youtu.be"])) return "youtube";
  return null;
}

// Several of these services serve a different page to clients they don't
// recognise, so requests carry an ordinary browser UA.
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Discogs asks API clients to identify themselves properly and rate-limits
// those that don't.
export const DISCOGS_UA = "MartinBarkerDotMe/1.0 +https://martinbarker.me";

export function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");   // last, so "&amp;quot;" doesn't become a quote
}

// Protocol-relative URLs ("//host/path") break `new URL()` on the client.
export const absolute = (u) => (u && u.startsWith("//") ? `https:${u}` : u);

// Enough genre tags to describe a release; past this a hashtag line stops
// being readable and starts being spam.
export const MAX_TAGS = 10;

// De-duplicated, trimmed, capped — case-insensitively, so a source listing
// both "Electronic" and "electronic" doesn't yield the same hashtag twice.
export function cleanTags(values) {
  const seen = new Set();
  const out = [];
  for (const entry of values || []) {
    const tag = decodeEntities(String(entry)).trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// The first 4-digit year out of the candidates, in preference order.
export const firstYear = (...values) => {
  for (const v of values) {
    const m = /\b(\d{4})\b/.exec(String(v || ""));
    if (m) return m[1];
  }
  return "";
};

export const jsonError = (message, status = 400) =>
  Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
