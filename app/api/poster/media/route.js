// Streams one file (audio or artwork) from a source's CDN back to the browser.
//
// The renderer runs in the page, so it needs the bytes as a same-origin fetch:
// none of these CDNs send a CORS header, which means a direct fetch never
// reaches JavaScript. Only the hosts in shared.js are accepted — see the note
// there on why an allowlist is the point of this file.

import { parseMediaUrl, BROWSER_UA, jsonError } from "../shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Artwork is a few MB and a 128kbps stream is ~1MB/minute; this is a sanity
// bound so a bad URL can't stream indefinitely through the server.
const MAX_BYTES = 150 * 1024 * 1024;

// Bandcamp's CDN checks the referer on stream URLs. The others don't care, but
// sending the matching one costs nothing and keeps the request ordinary.
const REFERERS = {
  "bcbits.com": "https://bandcamp.com/",
  "discogs.com": "https://www.discogs.com/",
  "ytimg.com": "https://www.youtube.com/",
  "youtube.com": "https://www.youtube.com/",
};

const refererFor = (host) => {
  const key = Object.keys(REFERERS).find(k => host === k || host.endsWith(`.${k}`));
  return key ? REFERERS[key] : undefined;
};

export async function GET(request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return jsonError("Pass a media URL as ?url=");

  let target;
  try {
    target = parseMediaUrl(raw);
  } catch (e) {
    return jsonError(e.message);
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent": BROWSER_UA,
        Referer: refererFor(target.hostname.toLowerCase()),
        Accept: "*/*",
      },
      redirect: "follow",
      cache: "no-store",
    });
  } catch (e) {
    return jsonError(`Couldn't reach that CDN: ${e.message}`, 502);
  }

  if (!upstream.ok || !upstream.body) {
    // A 404 here is routine, not a fault: the page tries artwork candidates in
    // order (YouTube's maxresdefault only exists for large enough uploads).
    return jsonError(`That file isn't available (${upstream.status}).`,
      upstream.status === 404 ? 404 : 502);
  }

  const declared = Number(upstream.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) {
    return jsonError("That file is larger than this endpoint will proxy.", 413);
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
    // The renderer reads this straight into the ffmpeg VFS; nothing downstream
    // should hold a copy.
    "Cache-Control": "no-store",
  });
  if (declared) headers.set("Content-Length", String(declared));

  // Passed through as a stream rather than buffered, so a long track doesn't
  // sit in the server's memory on its way to the browser.
  return new Response(upstream.body, { status: 200, headers });
}
