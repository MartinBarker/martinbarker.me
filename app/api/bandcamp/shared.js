// Shared guards for the two /api/bandcamp handlers.
//
// Both take a URL from the browser and fetch it from the server, which is a
// request forgery hole unless the host is checked first: without an allowlist,
// `?url=http://169.254.169.254/...` would hand the caller the instance
// metadata of whatever box this is deployed on. So each handler accepts only
// the hosts it actually needs — bandcamp.com for pages, bcbits.com (Bandcamp's
// CDN) for the audio and artwork those pages point at.

const PAGE_HOSTS = ["bandcamp.com"];
const MEDIA_HOSTS = ["bcbits.com"];

const hostMatches = (host, suffixes) =>
  suffixes.some(s => host === s || host.endsWith(`.${s}`));

// Parses and vets a caller-supplied URL. Returns a URL object, or throws with a
// message meant for the user.
function parseAllowed(raw, suffixes, what) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    throw new Error(`That doesn't look like a URL.`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  if (!hostMatches(u.hostname.toLowerCase(), suffixes)) {
    throw new Error(`Only ${what} URLs are supported (got ${u.hostname}).`);
  }
  return u;
}

export const parseBandcampPageUrl = (raw) =>
  parseAllowed(raw, PAGE_HOSTS, "bandcamp.com");

export const parseBandcampMediaUrl = (raw) =>
  parseAllowed(raw, MEDIA_HOSTS, "bcbits.com (Bandcamp CDN)");

// Bandcamp serves a different page to clients it doesn't recognise, so the
// requests carry an ordinary browser UA.
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const jsonError = (message, status = 400) =>
  Response.json({ error: message }, { status });
