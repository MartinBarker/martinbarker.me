// Server component for the discord2playlist results page. Verifies the magic
// token by calling the bot API server-side (with the shared secret) and renders
// the track list + actions via the client ResultsView.
import { notFound } from 'next/navigation';
import ResultsView from './ResultsView';

// Always render fresh — the token is single-use-ish and results change.
export const dynamic = 'force-dynamic';

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3000';

export default async function ResultsPage({ params, searchParams }) {
  const { scanId } = await params;
  const { t: token } = await searchParams;
  if (!token) notFound();

  let data;
  try {
    const res = await fetch(`${BOT_API_URL}/api/scans/${scanId}?t=${encodeURIComponent(token)}`, {
      headers: { 'x-site-secret': process.env.SITE_SHARED_SECRET || '' },
      cache: 'no-store',
    });
    if (!res.ok) notFound();
    data = await res.json();
  } catch {
    notFound();
  }

  return (
    <ResultsView
      scanId={scanId}
      token={token}
      tracks={data.tracks || []}
      alreadyConnected={!!data.alreadyConnected}
      scanJob={data.scanJob || null}
    />
  );
}
