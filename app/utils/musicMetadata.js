/**
 * Shared music metadata utilities for tag generation, title formatting,
 * and timestamp formatting. Used by /tagger and /vinyl-digitizer routes.
 */

/** Remove Discogs suffixes like "(2)" and normalize slashes */
export function cleanName(name) {
  if (!name) return '';
  return name
    .replace(/\s+\(\d+\)$/, '')
    .replace(/\s*\/\s*/g, ', ')
    .trim();
}

/** Remove trailing (number) suffix only */
export function cleanDiscogsSuffix(name) {
  if (!name) return '';
  return name.replace(/\s+\(\d+\)$/, '');
}

/**
 * Extract tags from a Discogs API response into categorized arrays.
 * Returns { artists, album, tracklist, combinations, credits, filenames }
 */
export function extractTagsFromDiscogs(response, filenames = []) {
  if (!response) return { artists: [], album: [], tracklist: [], combinations: [], credits: [], filenames: [] };

  const cats = {
    artists: new Set(),
    album: new Set(),
    tracklist: new Set(),
    combinations: new Set(),
    credits: new Set(),
    filenames: new Set(),
  };

  const addClean = (set, name) => {
    const cleaned = cleanName(name);
    cleaned.split(',').forEach(item => {
      const trimmed = item.trim();
      if (trimmed) set.add(trimmed);
    });
  };

  // Artists
  if (response.artists) {
    response.artists.forEach(a => { if (a.name) addClean(cats.artists, a.name); });
  }

  // Album info
  if (response.title) addClean(cats.album, response.title);
  if (response.released) cats.album.add(response.released.substring(0, 4));
  if (response.genres) response.genres.forEach(g => addClean(cats.album, g));
  if (response.styles) response.styles.forEach(s => addClean(cats.album, s));
  if (response.labels?.[0]?.name) addClean(cats.album, response.labels[0].name);

  // Extra artists (album level)
  if (response.extraartists) {
    response.extraartists.forEach(a => {
      if (a.name) {
        addClean(cats.artists, a.name);
        if (a.role) cats.credits.add(`${a.name.replace(/\s+\(\d+\)$/, '')} (${a.role})`);
      }
    });
  }

  // Tracklist
  if (response.tracklist) {
    response.tracklist.forEach(track => {
      if (track.title) addClean(cats.tracklist, track.title);
      if (track.artists) track.artists.forEach(a => { if (a.name) addClean(cats.artists, a.name); });
      if (track.extraartists) {
        track.extraartists.forEach(a => {
          if (a.name) {
            addClean(cats.artists, a.name);
            if (a.role) cats.credits.add(`${a.name.replace(/\s+\(\d+\)$/, '')} (${a.role})`);
          }
        });
      }
    });
  }

  // Combinations
  const albumTitle = response.title ? cleanName(response.title).split(',')[0].trim() : '';
  const mainArtists = Array.from(cats.artists);
  if (albumTitle && mainArtists.length > 0) {
    mainArtists.slice(0, 3).forEach(artist => cats.combinations.add(`${artist} ${albumTitle}`));
  }
  if (response.genres && mainArtists.length > 0) {
    response.genres.slice(0, 2).forEach(genre => {
      const cg = cleanName(genre).split(',')[0].trim();
      if (cg) mainArtists.slice(0, 2).forEach(artist => cats.combinations.add(`${artist} ${cg}`));
    });
  }

  // Filenames
  filenames.forEach(f => { if (f) cats.filenames.add(f); });

  return {
    artists: Array.from(cats.artists),
    album: Array.from(cats.album),
    tracklist: Array.from(cats.tracklist),
    combinations: Array.from(cats.combinations),
    credits: Array.from(cats.credits),
    filenames: Array.from(cats.filenames),
  };
}

/**
 * Build a comma-separated tag string from categorized tags + per-category filters.
 * filters: { artists: { enabled, sliderValue }, album: { ... }, ... }
 */
export function buildTagString(tags, filters) {
  const all = new Set();
  for (const cat of ['artists', 'album', 'tracklist', 'combinations', 'credits', 'filenames']) {
    const f = filters[cat];
    const arr = tags[cat];
    if (!f?.enabled || !arr?.length) continue;
    const count = Math.ceil((arr.length * (f.sliderValue ?? 100)) / 100);
    arr.slice(0, count).forEach(t => all.add(t));
  }
  return Array.from(all).join(', ');
}

/**
 * Generate up to 5 YouTube title recommendations from Discogs data.
 */
export function generateVideoTitleRecommendations(discogsData, variation = 0) {
  if (!discogsData) return [];

  const a = discogsData.artists?.[0]?.name ? cleanDiscogsSuffix(discogsData.artists[0].name) : '';
  const t = discogsData.title ? cleanDiscogsSuffix(discogsData.title) : '';
  const y = discogsData.released ? discogsData.released.substring(0, 4) : '';
  const g = discogsData.genres || [];
  const s = discogsData.styles || [];
  const l = discogsData.labels?.[0]?.name ? cleanDiscogsSuffix(discogsData.labels[0].name) : '';
  const c = discogsData.country || '';

  if (!a || !t) return [];

  const formatSets = [
    [
      () => y && g.length > 0 ? `${t} - ${a} | ${y} | ${g[0]} | Full Album` : null,
      () => y && g.length > 0 ? `${a} - ${t} (${y}) [${g[0]}] Full Album` : null,
      () => y ? `${t} by ${a} • ${y} • Full Album` : null,
      () => l && y ? `${a} - ${t} | ${l} | ${y} | Complete Album` : null,
      () => c && y ? `${t} - ${a} [${c} ${y}] Full LP` : null,
    ],
    [
      () => s.length > 0 && y ? `${a} - ${t} | ${s[0]} | ${y} | Full Album` : null,
      () => s.length > 0 ? `${t} (${a}) | ${s[0]} Full Album` : null,
      () => s.length > 1 && y ? `${t} - ${a} | ${s[0]} ${s[1]} | ${y}` : null,
      () => g.length > 0 && s.length > 0 ? `${a}: ${t} | ${g[0]}/${s[0]} | Complete LP` : null,
      () => y ? `${t} by ${a} (${y}) | Full Album` : null,
    ],
    [
      () => l && c ? `${t} - ${a} | ${l} (${c}) | Full Album` : null,
      () => l && y ? `${a}: ${t} | ${l} ${y} | Complete Album` : null,
      () => c && g.length > 0 ? `${t} | ${a} | ${c} ${g[0]} | Full LP` : null,
      () => l ? `${a} - ${t} | ${l} Records | Full Album` : null,
      () => y && c ? `${t} (${y}) - ${a} | ${c} Release | Full Album` : null,
    ],
    [
      () => y && g.length > 0 ? `${a} - ${t} - ${g[0]} - ${y} - Full Album` : null,
      () => y ? `${t} / ${a} / ${y} / Complete Album` : null,
      () => g.length > 0 ? `[${g[0]}] ${a} - ${t} | Full Album` : null,
      () => s.length > 0 && y ? `${t} - ${a} - ${s[0]} - ${y} - Full LP` : null,
      () => `${a} presents: ${t} | Complete Album`,
    ],
    [
      () => g.length > 1 ? `${t} - ${a} | ${g[0]} & ${g[1]} | Full Album` : null,
      () => g.length > 0 && s.length > 0 && y ? `${a} - ${t} | ${g[0]}/${s[0]} | ${y} | Full LP` : null,
      () => s.length > 1 ? `${t} by ${a} | ${s[0]} + ${s[1]} | Complete Album` : null,
      () => g.length > 0 && y ? `${t} | ${a} | ${g[0]} Classic | ${y}` : null,
      () => l && g.length > 0 ? `${a}: ${t} | ${l} | ${g[0]} | Full Album` : null,
    ],
  ];

  const recs = [];
  const set = formatSets[variation % formatSets.length];
  set.forEach(fn => { const r = fn(); if (r) recs.push(r); });

  const fallbacks = [
    `${t} - ${a} | Full Album`,
    `${a} - ${t} | Complete Album`,
    `${t} by ${a} - Full LP`,
    `${a}: ${t} | Full Album`,
    `${t} (${a}) | Complete Album`,
  ];
  fallbacks.forEach(fb => { if (recs.length < 5 && !recs.includes(fb)) recs.push(fb); });

  return [...new Set(recs)].slice(0, 5);
}

/**
 * Format a timestamp for YouTube descriptions.
 * @param {number} seconds
 * @param {string} format - "M:SS" (default), "MM:SS", "H:MM:SS"
 */
export function formatTimestamp(seconds, format = 'auto') {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (format === 'H:MM:SS' || (format === 'auto' && h > 0)) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Build a YouTube description with timestamps from track list.
 * @param {Array} tracks - [{title, startOffset}] where startOffset is cumulative seconds
 * @param {object} options
 * @param {string} options.timestampFormat - "auto", "M:SS", "H:MM:SS"
 * @param {string} options.separator - between timestamp and title, default " "
 * @param {boolean} options.includeTrackNumbers - prefix "1. ", "2. ", etc.
 * @param {string} options.suffix - appended after tracklist
 */
export function buildTimestampDescription(tracks, options = {}) {
  const {
    timestampFormat = 'auto',
    separator = ' ',
    includeTrackNumbers = false,
    suffix = '\n\nDigitized with Vinyl Digitizer – https://martinbarker.me/vinyl-digitizer',
  } = options;

  const lines = tracks.map((t, i) => {
    const ts = formatTimestamp(t.startOffset, timestampFormat);
    const prefix = includeTrackNumbers ? `${i + 1}. ` : '';
    return `${ts}${separator}${prefix}${t.title}`;
  });

  return 'Video rendered with https://martinbarker.me/vinyl-digitizer\n\n' + lines.join('\n') + suffix;
}

/** YouTube metadata character limits */
export const YT_LIMITS = {
  title: 100,
  description: 5000,
  tags: 500,
  tagSingle: 30,
  hashtags: 15,
};
