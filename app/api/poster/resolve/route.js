// Reads a Bandcamp, Discogs or YouTube link and reports what the poster
// renderer needs from it, in one shape whatever the source.
//
// This has to happen server-side. None of these send an
// Access-Control-Allow-Origin header, so a browser fetch of the page (or of
// the media it points at) is blocked before it starts.

import { parsePageUrl, detectSource, jsonError } from "../shared";
import { resolveBandcamp } from "../sources/bandcamp";
import { resolveDiscogs } from "../sources/discogs";
import { resolveYouTube } from "../sources/youtube";

export const dynamic = "force-dynamic";   // never cache a lookup
export const runtime = "nodejs";

const RESOLVERS = {
  bandcamp: resolveBandcamp,
  discogs: resolveDiscogs,
  youtube: resolveYouTube,
};

// Handed to each resolver so a source can bail with its own message and status
// without every one of them importing the response helper.
class ResolveFailure extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => { throw new ResolveFailure(message, status); };

export async function GET(request) {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return jsonError("Pass a Bandcamp, Discogs or YouTube URL as ?url=");

  let pageUrl;
  try {
    pageUrl = parsePageUrl(raw);
  } catch (e) {
    return jsonError(e.message);
  }

  const source = detectSource(pageUrl);
  const resolve = RESOLVERS[source];
  if (!resolve) {
    return jsonError("Paste a Bandcamp, Discogs or YouTube link.");
  }

  let result;
  try {
    result = await resolve(pageUrl, { fail });
  } catch (e) {
    if (e instanceof ResolveFailure) return jsonError(e.message, e.status);
    return jsonError(`Lookup failed: ${e.message}`, 502);
  }

  // Nothing here is written down anywhere: the page is fetched with no-store,
  // parsed in memory, and the result is marked no-store on the way out so no
  // browser or proxy between here and the user keeps a copy either.
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
