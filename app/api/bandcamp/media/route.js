// Streams one file (audio or artwork) from Bandcamp's CDN back to the browser.
//
// The renderer runs in the page, so it needs the bytes as a same-origin fetch:
// bcbits.com sends no CORS header, which means a direct fetch never reaches
// JavaScript. Only the hosts in shared.js are accepted — see the note there on
// why an allowlist is the point of this file.

import { parseBandcampMediaUrl, BROWSER_UA, jsonError } from "../shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A cover is a few MB and a 128kbps stream is ~1MB/minute; this is a sanity
// bound so a bad URL can't stream indefinitely through the server.
const MAX_BYTES = 150 * 1024 * 1024;

export async function GET(request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return jsonError("Pass a bcbits.com URL as ?url=");

  let target;
  try {
    target = parseBandcampMediaUrl(raw);
  } catch (e) {
    return jsonError(e.message);
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: {
        "User-Agent": BROWSER_UA,
        // Bandcamp's CDN checks this on stream URLs.
        Referer: "https://bandcamp.com/",
        Accept: "*/*",
      },
      redirect: "follow",
      cache: "no-store",
    });
  } catch (e) {
    return jsonError(`Couldn't reach Bandcamp's CDN: ${e.message}`, 502);
  }

  if (!upstream.ok || !upstream.body) {
    return jsonError(`Bandcamp's CDN returned ${upstream.status} for that file.`, 502);
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
