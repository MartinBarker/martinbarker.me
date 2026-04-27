import fs from 'node:fs';
import path from 'node:path';
import Media2GifClient from './Media2GifClient';

export const dynamic = 'force-static';

function parseGifFilename(file) {
  const m = file.match(/^(.+?)\.(\d{4})\.[^-]+-Start\[(\d\d-\d\d-\d\d)\]-End\[(\d\d-\d\d-\d\d)\]-Quote\[(.*)\]\.gif$/);
  if (!m) return null;
  const [, movie, yearStr, startRaw, endRaw, quoteRaw] = m;
  const toSec = (raw) => {
    const [h, mm, s] = raw.split('-').map(Number);
    return h * 3600 + mm * 60 + s;
  };
  const startSec = toSec(startRaw);
  const endSec = toSec(endRaw);
  const dur = Math.max(0, endSec - startSec);
  const start = startRaw.replace(/-/g, '-');
  const startLabel = `Start[${start}]`;
  const quote = (quoteRaw || '').trim();
  return {
    file,
    movie: movie.replace(/\./g, ' '),
    year: Number(yearStr),
    startLabel,
    startSec,
    durSec: dur,
    durLabel: `${dur.toFixed(1)}s`,
    quote,
  };
}

function loadGifs() {
  try {
    const dir = path.join(process.cwd(), 'public', 'gifs');
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.gif'));
    return files
      .map(parseGifFilename)
      .filter(Boolean)
      .sort((a, b) => a.startSec - b.startSec);
  } catch {
    return [];
  }
}

export default function Page() {
  const gifs = loadGifs();
  return <Media2GifClient gifs={gifs} />;
}
