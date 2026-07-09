'use client';
import React, { useState, useEffect, useRef, useContext, useMemo, useCallback } from 'react';
import { ColorContext } from '../../../ColorContext';

// Bot API base for browser calls (OAuth popup + SSE). NEXT_PUBLIC_* is inlined
// at build time; since we don't set it during the Docker build, derive the URL
// from the current host instead: the public bot host in prod, localhost in dev.
const BOT_API_URL =
  process.env.NEXT_PUBLIC_BOT_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? 'https://bot.martinbarker.me'
    : 'http://localhost:3000');

const PLATFORM_LABEL = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp',
};

// Mirrors the /schedule command's presets in the bot (commands/schedule.js).
const CADENCE_LABEL = {
  '0 * * * *': 'every hour',
  '0 */6 * * *': 'every 6 hours',
  '0 0 * * *': 'every day',
  '0 0 * * 0': 'every week',
};

const PAGE_SIZES = [10, 25, 50, 100];

const STATUS_LABEL = {
  inserted: 'Added',
  skipped: 'Already in playlist',
  failed: 'Failed',
  pending: 'Pending',
  adding: 'Adding…',
};

export default function ResultsView({
  scanId,
  token,
  tracks,
  alreadyConnected,
  scanJob,
  youtubeChannel,
  targetPlaylist,
  itemStatuses = {},
  discord = {},
  quotaCostPerInsert = 50,
}) {
  const ctx = useContext(ColorContext) || {};
  const darkMode = !!ctx.darkMode;

  const [connected, setConnected] = useState(alreadyConnected);
  const [channel, setChannel] = useState(youtubeChannel);

  // Destination: an existing playlist, or a new one built from `newPlaylist`.
  const [mode, setMode] = useState(targetPlaylist ? 'existing' : 'new');
  const [playlists, setPlaylists] = useState(null);
  const [playlistsError, setPlaylistsError] = useState('');
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState(targetPlaylist?.id || '');
  const [playlistFilter, setPlaylistFilter] = useState('');

  const defaultTitle = discord.inputChannelName
    ? `#${discord.inputChannelName} — Discord2Playlist`
    : `Discord2Playlist — scan ${scanId}`;
  const [newPlaylist, setNewPlaylist] = useState({
    title: defaultTitle,
    description:
      `Music links shared in ${discord.inputChannelName ? `#${discord.inputChannelName}` : 'Discord'}` +
      `${discord.guildName ? ` (${discord.guildName})` : ''}. ` +
      'Collected by discord2playlist — https://martinbarker.me/discord2playlist',
    privacy: 'private',
    tags: '',
    language: '',
  });

  // Push run state.
  const [pushing, setPushing] = useState(false);
  const [total, setTotal] = useState(0);
  const [inserted, setInserted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [failed, setFailed] = useState(0);
  const [liveStatuses, setLiveStatuses] = useState({});
  const [rateLimit, setRateLimit] = useState(null);
  const [aborted, setAborted] = useState(null);
  const [error, setError] = useState('');
  const [resultPlaylist, setResultPlaylist] = useState(targetPlaylist || null);
  const evtRef = useRef(null);

  const t = {
    bg: darkMode ? '#1e1e2e' : '#ffffff',
    card: darkMode ? '#252538' : '#f7f9fc',
    input: darkMode ? '#1b1b2a' : '#ffffff',
    text: darkMode ? '#f0f0f5' : '#1a1a2e',
    sub: darkMode ? '#a0aec0' : '#5a6478',
    border: darkMode ? '#3a3a52' : '#e3e8ee',
    ok: darkMode ? '#68d391' : '#16794c',
    warn: darkMode ? '#f6ad55' : '#b45309',
    bad: darkMode ? '#fc8181' : '#c53030',
    accent: '#2563eb',
  };

  const youtubeTracks = useMemo(() => tracks.filter(tr => tr.platform === 'youtube'), [tracks]);

  // The playlist the push will actually target right now. When the user picks a
  // different playlist than the one this scan last used, the stored per-video
  // statuses no longer describe the destination, so they're hidden.
  const activePlaylistId = mode === 'existing' ? selectedPlaylistId : null;
  const savedStatusesApply = !!activePlaylistId && activePlaylistId === targetPlaylist?.id;

  const statusFor = useCallback(
    mediaId => liveStatuses[mediaId] || (savedStatusesApply ? itemStatuses[mediaId] : undefined),
    [liveStatuses, savedStatusesApply, itemStatuses]
  );

  const pendingCount = useMemo(
    () =>
      youtubeTracks.filter(tr => {
        const s = statusFor(tr.media_id)?.status;
        return s !== 'inserted' && s !== 'skipped';
      }).length,
    [youtubeTracks, statusFor]
  );

  const failures = useMemo(
    () =>
      youtubeTracks
        .map(tr => ({ track: tr, status: statusFor(tr.media_id) }))
        .filter(r => r.status?.status === 'failed'),
    [youtubeTracks, statusFor]
  );

  // Receive the "connected" signal from the OAuth popup.
  useEffect(() => {
    const onMsg = e => {
      if (e?.data?.type === 'youtube-connected') {
        setConnected(true);
        setError('');
        setPlaylists(null); // force a refetch for the newly connected channel
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => () => evtRef.current?.close(), []);

  const loadPlaylists = useCallback(async () => {
    setLoadingPlaylists(true);
    setPlaylistsError('');
    try {
      const res = await fetch(
        `${BOT_API_URL}/api/scans/${scanId}/youtube/playlists?t=${encodeURIComponent(token)}`
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || body.error || 'Could not load your playlists.');
      setPlaylists(body.playlists);
      if (body.channel) setChannel(body.channel);
    } catch (err) {
      setPlaylistsError(err.message);
      setPlaylists([]);
    } finally {
      setLoadingPlaylists(false);
    }
  }, [scanId, token]);

  useEffect(() => {
    if (connected && mode === 'existing' && playlists === null && !loadingPlaylists) loadPlaylists();
  }, [connected, mode, playlists, loadingPlaylists, loadPlaylists]);

  // Countdown ticker, only mounted while YouTube is throttling us.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!rateLimit) return undefined;
    const id = setInterval(() => forceTick(n => n + 1), 500);
    return () => clearInterval(id);
  }, [rateLimit]);

  const connectYouTube = () => {
    const url = `${BOT_API_URL}/api/scans/${scanId}/youtube/oauth/start?t=${encodeURIComponent(token)}`;
    window.open(url, 'connect-youtube', 'width=520,height=680');
  };

  const pushUrl = () => {
    const params = new URLSearchParams({ t: token });
    if (mode === 'existing') {
      params.set('playlistId', selectedPlaylistId);
    } else {
      params.set('mode', 'new');
      params.set('title', newPlaylist.title);
      params.set('description', newPlaylist.description);
      params.set('privacy', newPlaylist.privacy);
      if (newPlaylist.tags.trim()) params.set('tags', newPlaylist.tags);
      if (newPlaylist.language.trim()) params.set('language', newPlaylist.language.trim());
    }
    return `${BOT_API_URL}/api/scans/${scanId}/push?${params.toString()}`;
  };

  const addAll = () => {
    setError('');
    setAborted(null);
    setRateLimit(null);
    setPushing(true);
    setInserted(0);
    setSkipped(0);
    setFailed(0);
    setTotal(0);
    setLiveStatuses({});

    const evt = new EventSource(pushUrl());
    evtRef.current = evt;

    evt.addEventListener('start', e => {
      const d = JSON.parse(e.data);
      setTotal(d.total);
      setResultPlaylist({ id: d.playlistId, title: d.playlistTitle, url: d.playlistUrl });
      // A freshly created playlist becomes the selection, so hitting "resume"
      // after a rate-limit abort tops it up instead of creating another one.
      if (d.createdPlaylist) {
        setMode('existing');
        setSelectedPlaylistId(d.playlistId);
        setPlaylists(prev => [
          { id: d.playlistId, title: d.playlistTitle, itemCount: 0, privacyStatus: newPlaylist.privacy, url: d.playlistUrl },
          ...(prev || []),
        ]);
      }
    });

    evt.addEventListener('progress', e => {
      const d = JSON.parse(e.data);
      setRateLimit(null); // a completed item means we're moving again
      setLiveStatuses(prev => ({
        ...prev,
        [d.mediaId]: { status: d.status, error: d.message, reason: d.reason },
      }));
      if (d.status === 'inserted') setInserted(n => n + 1);
      else if (d.status === 'skipped') setSkipped(n => n + 1);
      else if (d.status === 'failed') setFailed(n => n + 1);
    });

    evt.addEventListener('retry', e => {
      const d = JSON.parse(e.data);
      setRateLimit({ ...d, resumeAt: Date.now() + d.delayMs });
      setLiveStatuses(prev => ({ ...prev, [d.mediaId]: { status: 'adding' } }));
    });

    evt.addEventListener('aborted', e => {
      const d = JSON.parse(e.data);
      setAborted(d);
      setRateLimit(null);
      if (d.playlistId) setResultPlaylist(p => p || { id: d.playlistId, url: d.playlistUrl });
      setPushing(false);
      evt.close();
    });

    evt.addEventListener('done', e => {
      const d = JSON.parse(e.data);
      setResultPlaylist({ id: d.playlistId, title: d.playlistTitle, url: d.playlistUrl });
      setRateLimit(null);
      setPushing(false);
      evt.close();
    });

    evt.addEventListener('error', e => {
      let code;
      let message;
      try {
        const d = JSON.parse(e.data);
        code = d.code;
        message = d.message;
      } catch {
        // A transport-level EventSource failure carries no payload.
      }
      if (code === 'no_youtube' || code === 'invalid_grant') {
        setConnected(false);
        setError(message || 'Please connect YouTube first.');
      } else {
        setError(message || 'Connection dropped — click “Add to playlist” to resume where it left off.');
      }
      setRateLimit(null);
      setPushing(false);
      evt.close();
    });
  };

  const canPush =
    connected &&
    !pushing &&
    pendingCount > 0 &&
    (mode === 'new' ? newPlaylist.title.trim().length > 0 : !!selectedPlaylistId);

  const processed = inserted + skipped + failed;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '32px 20px', color: t.text }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Your scanned tracks</h1>
      <p style={{ color: t.sub, marginTop: 0 }}>
        Found <strong>{tracks.length}</strong> track{tracks.length === 1 ? '' : 's'}
        {youtubeTracks.length !== tracks.length && (
          <> · <strong>{youtubeTracks.length}</strong> on YouTube (addable to a playlist)</>
        )}
        {discord.inputChannelName && <> · scanned from #{discord.inputChannelName}</>}.
      </p>

      {/* ---------- Step 1: YouTube connection ---------- */}
      <Card t={t}>
        <SectionTitle t={t}>1 · Connect YouTube</SectionTitle>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {connected ? (
            <>
              <span style={{ color: t.ok, fontWeight: 600 }}>
                ✅ Connected{channel?.name ? ` as ${channel.name}` : ''}
              </span>
              <button onClick={connectYouTube} style={btnStyle('transparent', false, t.sub, t.border)}>
                Reconnect
              </button>
            </>
          ) : (
            <button onClick={connectYouTube} style={btnStyle('#dc2626')}>Connect YouTube</button>
          )}
        </div>
      </Card>

      {/* ---------- Step 2: Destination playlist ---------- */}
      <Card t={t}>
        <SectionTitle t={t}>2 · Choose where the videos go</SectionTitle>

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 16 }}>
          <Radio
            t={t}
            name="dest"
            checked={mode === 'existing'}
            onChange={() => setMode('existing')}
            label="Add to an existing playlist"
          />
          <Radio
            t={t}
            name="dest"
            checked={mode === 'new'}
            onChange={() => setMode('new')}
            label="Create a new playlist"
          />
        </div>

        {mode === 'existing' ? (
          <ExistingPlaylistPicker
            t={t}
            connected={connected}
            playlists={playlists}
            loading={loadingPlaylists}
            error={playlistsError}
            filter={playlistFilter}
            setFilter={setPlaylistFilter}
            selectedId={selectedPlaylistId}
            setSelectedId={setSelectedPlaylistId}
            onReload={loadPlaylists}
            savedId={targetPlaylist?.id}
          />
        ) : (
          <NewPlaylistForm t={t} value={newPlaylist} onChange={setNewPlaylist} />
        )}
      </Card>

      {/* ---------- Step 3: Push ---------- */}
      <Card t={t}>
        <SectionTitle t={t}>3 · Add the videos</SectionTitle>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={addAll} disabled={!canPush} style={btnStyle(t.accent, !canPush)}>
            {pushing
              ? `Adding ${processed}/${total}…`
              : youtubeTracks.length === 0
                ? 'No YouTube links to add'
                : pendingCount === 0
                  ? 'All videos already added'
                  : `Add ${pendingCount} video${pendingCount === 1 ? '' : 's'} to playlist`}
          </button>
          {resultPlaylist?.id && (
            <a
              href={resultPlaylist.url || `https://www.youtube.com/playlist?list=${resultPlaylist.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: t.accent, fontWeight: 600 }}
            >
              View {resultPlaylist.title ? `“${resultPlaylist.title}”` : 'playlist'} on YouTube →
            </a>
          )}
        </div>

        {(pushing || processed > 0) && (
          <ProgressBar t={t} total={total} inserted={inserted} skipped={skipped} failed={failed} />
        )}

        {rateLimit && <RateLimitNotice t={t} rateLimit={rateLimit} />}

        {aborted && (
          <Banner t={t} tone={aborted.rateLimited ? 'warn' : 'bad'}>
            <strong>Stopped early — {aborted.message}</strong>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              {aborted.inserted} added, {aborted.failed} failed, {aborted.remaining} not attempted.
              Nothing is lost: the videos already added stay in the playlist, and clicking{' '}
              <em>Add to playlist</em> again resumes from where it stopped.
            </div>
          </Banner>
        )}

        {error && <Banner t={t} tone="bad">{error}</Banner>}

        {!pushing && !aborted && !error && processed > 0 && (
          <Banner t={t} tone={failed > 0 ? 'warn' : 'ok'}>
            Done — {inserted} added{skipped > 0 ? `, ${skipped} already there` : ''}
            {failed > 0 ? `, ${failed} failed` : ''}.
          </Banner>
        )}

        {failures.length > 0 && <FailureList t={t} failures={failures} />}

        <p style={{ color: t.sub, fontSize: 12, marginBottom: 0, marginTop: 14 }}>
          Each video added costs {quotaCostPerInsert} units of YouTube&apos;s 10,000/day API quota
          (about {Math.floor(10000 / quotaCostPerInsert)} videos per day, shared across everyone using
          this bot). If the quota runs out the push stops cleanly and resumes after it resets at
          midnight Pacific Time.
        </p>
      </Card>

      {/* ---------- Auto-add instructions ---------- */}
      <AutoAddInstructions
        t={t}
        scanJob={scanJob}
        discord={discord}
        connected={connected}
        playlistTitle={resultPlaylist?.title || targetPlaylist?.title}
      />

      {/* ---------- Track table ---------- */}
      <TrackTable t={t} tracks={tracks} statusFor={statusFor} showStatus={!!activePlaylistId || Object.keys(liveStatuses).length > 0} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Destination pickers                                                 */
/* ------------------------------------------------------------------ */

function ExistingPlaylistPicker({
  t, connected, playlists, loading, error, filter, setFilter,
  selectedId, setSelectedId, onReload, savedId,
}) {
  const visible = useMemo(() => {
    if (!playlists) return [];
    const q = filter.trim().toLowerCase();
    return q ? playlists.filter(p => p.title.toLowerCase().includes(q)) : playlists;
  }, [playlists, filter]);

  if (!connected) {
    return <p style={{ color: t.sub, margin: 0 }}>Connect YouTube above to see your playlists.</p>;
  }
  if (loading) return <p style={{ color: t.sub, margin: 0 }}>Loading your playlists…</p>;
  if (error) return <Banner t={t} tone="bad">{error}</Banner>;
  if (playlists && playlists.length === 0) {
    return (
      <p style={{ color: t.sub, margin: 0 }}>
        This channel has no playlists yet — switch to <em>Create a new playlist</em>.
      </p>
    );
  }

  const selected = playlists?.find(p => p.id === selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter playlists by name…"
          style={inputStyle(t, { flex: 1, minWidth: 220 })}
        />
        <button onClick={onReload} style={btnStyle('transparent', false, t.sub, t.border)}>Refresh</button>
      </div>

      <select
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
        size={Math.min(Math.max(visible.length, 2), 8)}
        style={inputStyle(t, { padding: 6 })}
      >
        {visible.length === 0 && <option disabled>No playlists match “{filter}”</option>}
        {visible.map(p => (
          <option key={p.id} value={p.id}>
            {p.title} · {p.itemCount} video{p.itemCount === 1 ? '' : 's'} · {p.privacyStatus}
            {p.id === savedId ? ' · last used for this scan' : ''}
          </option>
        ))}
      </select>

      {selected && (
        <p style={{ color: t.sub, fontSize: 13, margin: 0 }}>
          Videos already in <strong>{selected.title}</strong> are skipped, so re-running is safe.{' '}
          <a href={selected.url} target="_blank" rel="noopener noreferrer" style={{ color: t.accent }}>
            Open on YouTube →
          </a>
        </p>
      )}
    </div>
  );
}

function NewPlaylistForm({ t, value, onChange }) {
  const set = (key, v) => onChange({ ...value, [key]: v });
  const PRIVACY_HELP = {
    private: 'Only you can see it.',
    unlisted: 'Anyone with the link can see it; it stays out of search.',
    public: 'Listed on your channel and searchable.',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field t={t} label="Playlist title" hint={`${value.title.length}/150`}>
        <input
          value={value.title}
          maxLength={150}
          onChange={e => set('title', e.target.value)}
          style={inputStyle(t)}
        />
      </Field>

      <Field t={t} label="Description" hint={`${value.description.length}/5000`}>
        <textarea
          value={value.description}
          maxLength={5000}
          rows={3}
          onChange={e => set('description', e.target.value)}
          style={inputStyle(t, { resize: 'vertical', fontFamily: 'inherit' })}
        />
      </Field>

      <Field t={t} label="Visibility" hint={PRIVACY_HELP[value.privacy]}>
        <select value={value.privacy} onChange={e => set('privacy', e.target.value)} style={inputStyle(t)}>
          <option value="private">Private</option>
          <option value="unlisted">Unlisted</option>
          <option value="public">Public</option>
        </select>
      </Field>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Field t={t} label="Tags (optional)" hint="Comma-separated, up to 20" style={{ flex: 2, minWidth: 220 }}>
          <input
            value={value.tags}
            onChange={e => set('tags', e.target.value)}
            placeholder="discord, music, mixes"
            style={inputStyle(t)}
          />
        </Field>
        <Field t={t} label="Language (optional)" hint="ISO code, e.g. en" style={{ flex: 1, minWidth: 140 }}>
          <input
            value={value.language}
            onChange={e => set('language', e.target.value)}
            placeholder="en"
            style={inputStyle(t)}
          />
        </Field>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progress + errors                                                   */
/* ------------------------------------------------------------------ */

function ProgressBar({ t, total, inserted, skipped, failed }) {
  const processed = inserted + skipped + failed;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ height: 8, borderRadius: 999, background: t.border, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: failed > 0 ? t.warn : t.accent, transition: 'width .2s' }} />
      </div>
      <div style={{ color: t.sub, fontSize: 13, marginTop: 6 }}>
        {processed} of {total} processed — {inserted} added
        {skipped > 0 ? `, ${skipped} already there` : ''}
        {failed > 0 ? `, ${failed} failed` : ''}.
      </div>
    </div>
  );
}

function RateLimitNotice({ t, rateLimit }) {
  const secondsLeft = Math.max(0, Math.ceil((rateLimit.resumeAt - Date.now()) / 1000));
  return (
    <Banner t={t} tone="warn">
      <strong>
        {rateLimit.rateLimited
          ? 'YouTube is rate limiting us'
          : `YouTube returned a temporary error (${rateLimit.reason})`}
        .
      </strong>{' '}
      Backing off and retrying in {secondsLeft}s — attempt {rateLimit.attempt} of{' '}
      {rateLimit.maxAttempts}. Leave this page open; nothing is lost.
    </Banner>
  );
}

function FailureList({ t, failures }) {
  // Group by message: 40 "video was deleted" rows is noise, one row saying
  // "40 videos: deleted or private" is the actual finding.
  const groups = useMemo(() => {
    const byMessage = new Map();
    for (const f of failures) {
      const key = f.status.error || 'Unknown error';
      if (!byMessage.has(key)) byMessage.set(key, []);
      byMessage.get(key).push(f.track);
    }
    return [...byMessage.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [failures]);

  return (
    <details style={{ marginTop: 14 }}>
      <summary style={{ cursor: 'pointer', color: t.bad, fontWeight: 600 }}>
        {failures.length} video{failures.length === 1 ? '' : 's'} could not be added — see why
      </summary>
      <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: t.sub, fontSize: 13 }}>
        {groups.map(([message, items]) => (
          <li key={message} style={{ marginBottom: 8 }}>
            <strong style={{ color: t.text }}>
              {items.length} video{items.length === 1 ? '' : 's'}:
            </strong>{' '}
            {message}
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {items.slice(0, 8).map(tr => (
                <a
                  key={tr.media_id}
                  href={`https://www.youtube.com/watch?v=${tr.media_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: t.accent, fontSize: 12 }}
                >
                  {tr.media_id}
                </a>
              ))}
              {items.length > 8 && <span style={{ fontSize: 12 }}>+{items.length - 8} more</span>}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Auto-add instructions                                               */
/* ------------------------------------------------------------------ */

function AutoAddInstructions({ t, scanJob, discord, connected, playlistTitle }) {
  const cron = scanJob?.cron_expression;
  const on = !!cron && scanJob?.is_active;
  const cadence = cron ? CADENCE_LABEL[cron] || `on \`${cron}\` (UTC)` : null;
  const channelRef = discord.inputChannelName ? `#${discord.inputChannelName}` : 'your channel';

  return (
    <Card t={t}>
      <SectionTitle t={t}>Set up auto-add</SectionTitle>

      <Banner t={t} tone={on ? 'ok' : 'plain'} compact>
        {on
          ? `Auto-add is ON for ${channelRef} — rescanning ${cadence}.`
          : `Auto-add is currently OFF for ${channelRef}.`}
        {scanJob?.last_run_at && (
          <span style={{ color: t.sub }}> Last run {new Date(scanJob.last_run_at).toLocaleString()}.</span>
        )}
      </Banner>

      <p style={{ color: t.sub, marginTop: 14 }}>
        With auto-add on, the bot rescans {channelRef} on a schedule and pushes any newly-shared
        YouTube links straight into{' '}
        {playlistTitle ? <strong>“{playlistTitle}”</strong> : 'the playlist you chose above'} — no
        need to come back to this page.
      </p>

      <ol style={{ color: t.text, lineHeight: 1.7, paddingLeft: 20, margin: '12px 0' }}>
        <li>
          <strong>Connect YouTube</strong> on this page. {connected
            ? <span style={{ color: t.ok }}>Done ✅</span>
            : <span style={{ color: t.warn }}>Not done yet — step 1 above.</span>}
          <div style={{ color: t.sub, fontSize: 13 }}>
            Scheduled runs push to <em>your</em> account, so the bot needs your stored connection.
          </div>
        </li>
        <li>
          <strong>Pick the destination playlist and click “Add to playlist” once.</strong>
          <div style={{ color: t.sub, fontSize: 13 }}>
            That choice is remembered for this scan — every later automatic run targets the same
            playlist.
          </div>
        </li>
        <li>
          <strong>Run the schedule command in Discord:</strong>
          <Code t={t}>
            /schedule input_channel:{channelRef} cadence:Every day
          </Code>
          <div style={{ color: t.sub, fontSize: 13 }}>
            Cadence options: <em>Every hour</em>, <em>Every 6 hours</em>, <em>Every day</em>,{' '}
            <em>Every week</em>. Schedules survive bot restarts.
          </div>
        </li>
      </ol>

      <p style={{ color: t.sub, fontSize: 13, marginBottom: 6 }}>
        <strong style={{ color: t.text }}>To turn it off:</strong> run{' '}
        <code style={codeInline(t)}>/schedule input_channel:{channelRef} cadence:Turn off</code>.
      </p>
      <p style={{ color: t.sub, fontSize: 13, margin: 0 }}>
        <strong style={{ color: t.text }}>If your YouTube connection lapses,</strong> a scheduled run
        can&apos;t push on your behalf — the bot DMs you a fresh link back to this page instead of
        failing silently.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Paginated track table                                               */
/* ------------------------------------------------------------------ */

function TrackTable({ t, tracks, statusFor, showStatus }) {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const platforms = useMemo(
    () => [...new Set(tracks.map(tr => tr.platform))].sort(),
    [tracks]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tracks.filter(tr => {
      if (platform !== 'all' && tr.platform !== platform) return false;
      if (statusFilter !== 'all') {
        const s = statusFor(tr.media_id)?.status || 'pending';
        if (statusFilter === 'pending' ? s !== 'pending' : s !== statusFilter) return false;
      }
      if (!q) return true;
      return (
        (tr.media_url || '').toLowerCase().includes(q) ||
        (tr.media_id || '').toLowerCase().includes(q) ||
        (tr.author_username || '').toLowerCase().includes(q)
      );
    });
  }, [tracks, query, platform, statusFilter, statusFor]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Filters can shrink the result set below the current page; clamp instead of
  // rendering an empty page.
  const safePage = Math.min(page, pageCount - 1);
  const rows = useMemo(
    () => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filtered, safePage, pageSize]
  );

  useEffect(() => { setPage(0); }, [query, platform, statusFilter, pageSize]);

  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', color: t.sub, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' };
  const td = { padding: '10px 12px', borderBottom: `1px solid ${t.border}`, verticalAlign: 'middle' };

  return (
    <Card t={t}>
      <SectionTitle t={t}>Tracks ({filtered.length})</SectionTitle>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search link, id, or who shared it…"
          style={inputStyle(t, { flex: 1, minWidth: 200 })}
        />
        <select value={platform} onChange={e => setPlatform(e.target.value)} style={inputStyle(t, { width: 'auto' })}>
          <option value="all">All platforms</option>
          {platforms.map(p => (
            <option key={p} value={p}>{PLATFORM_LABEL[p] || p}</option>
          ))}
        </select>
        {showStatus && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputStyle(t, { width: 'auto' })}>
            <option value="all">Any status</option>
            <option value="inserted">Added</option>
            <option value="skipped">Already in playlist</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        )}
      </div>

      <div style={{ overflowX: 'auto', border: `1px solid ${t.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 44 }}>#</th>
              <th style={{ ...th, width: 100 }}>Platform</th>
              <th style={th}>Link</th>
              <th style={{ ...th, width: 140 }}>Shared by</th>
              {showStatus && <th style={{ ...th, width: 150 }}>Status</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={showStatus ? 5 : 4} style={{ ...td, color: t.sub, textAlign: 'center', padding: 24 }}>
                  No tracks match these filters.
                </td>
              </tr>
            )}
            {rows.map((tr, i) => {
              const status = statusFor(tr.media_id);
              return (
                <tr key={`${tr.platform}:${tr.media_id}`}>
                  <td style={{ ...td, color: t.sub, fontVariantNumeric: 'tabular-nums' }}>
                    {safePage * pageSize + i + 1}
                  </td>
                  <td style={{ ...td, color: t.sub, fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                    {PLATFORM_LABEL[tr.platform] || tr.platform}
                  </td>
                  <td style={td}>
                    <a
                      href={tr.media_url ? `https://${tr.media_url}` : '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: t.text, textDecoration: 'none', wordBreak: 'break-all' }}
                    >
                      {tr.media_url || tr.media_id}
                    </a>
                  </td>
                  <td style={{ ...td, color: t.sub, fontSize: 13 }}>{tr.author_username || '—'}</td>
                  {showStatus && (
                    <td style={td}>
                      {tr.platform === 'youtube'
                        ? <StatusBadge t={t} status={status?.status || 'pending'} title={status?.error} />
                        : <span style={{ color: t.sub }}>—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, color: t.sub, fontSize: 13 }}>
        <button onClick={() => setPage(0)} disabled={safePage === 0} style={pagerStyle(t, safePage === 0)}>«</button>
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0} style={pagerStyle(t, safePage === 0)}>‹ Prev</button>
        <span>
          Page <strong style={{ color: t.text }}>{safePage + 1}</strong> of <strong style={{ color: t.text }}>{pageCount}</strong>
        </span>
        <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1} style={pagerStyle(t, safePage >= pageCount - 1)}>Next ›</button>
        <button onClick={() => setPage(pageCount - 1)} disabled={safePage >= pageCount - 1} style={pagerStyle(t, safePage >= pageCount - 1)}>»</button>

        <span style={{ marginLeft: 'auto' }}>
          Rows per page{' '}
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} style={inputStyle(t, { width: 'auto', padding: '4px 8px' })}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

function Card({ t, children }) {
  return (
    <section style={{
      padding: 18, background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 10, margin: '16px 0',
    }}>
      {children}
    </section>
  );
}

function SectionTitle({ t, children }) {
  return <h2 style={{ fontSize: 16, margin: '0 0 14px', color: t.text }}>{children}</h2>;
}

function Field({ t, label, hint, children, style }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: t.sub }}>{hint}</span>}
    </label>
  );
}

function Radio({ t, name, checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span style={{ color: t.text, fontWeight: checked ? 600 : 400 }}>{label}</span>
    </label>
  );
}

function Banner({ t, tone, children, compact }) {
  // Translucent fills so one set of tones reads correctly on both themes.
  const tones = {
    ok:    { fg: t.ok,   bg: 'rgba(22,163,74,.10)', bd: 'rgba(22,163,74,.35)' },
    warn:  { fg: t.warn, bg: 'rgba(217,119,6,.10)', bd: 'rgba(217,119,6,.35)' },
    bad:   { fg: t.bad,  bg: 'rgba(197,48,48,.10)', bd: 'rgba(197,48,48,.35)' },
    plain: { fg: t.text, bg: 'transparent',         bd: t.border },
  };
  const c = tones[tone] || tones.plain;
  return (
    <div style={{
      marginTop: compact ? 0 : 14, padding: compact ? '8px 12px' : '10px 14px',
      borderRadius: 8, background: c.bg, border: `1px solid ${c.bd}`,
      color: c.fg, fontSize: 14,
    }}>
      {children}
    </div>
  );
}

function StatusBadge({ t, status, title }) {
  const colors = {
    inserted: t.ok,
    skipped: t.sub,
    failed: t.bad,
    adding: t.accent,
    pending: t.sub,
  };
  return (
    <span
      title={title || undefined}
      style={{
        display: 'inline-block', padding: '3px 8px', borderRadius: 999,
        fontSize: 12, fontWeight: 600, color: colors[status] || t.sub,
        border: `1px solid ${colors[status] || t.border}`,
        cursor: title ? 'help' : 'default', whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function Code({ t, children }) {
  return (
    <pre style={{
      margin: '6px 0', padding: '8px 12px', background: t.input,
      border: `1px solid ${t.border}`, borderRadius: 6,
      fontSize: 13, overflowX: 'auto', color: t.text,
    }}>
      <code>{children}</code>
    </pre>
  );
}

function codeInline(t) {
  return {
    background: t.input, border: `1px solid ${t.border}`,
    borderRadius: 4, padding: '1px 5px', fontSize: 12, color: t.text,
  };
}

function inputStyle(t, extra = {}) {
  return {
    width: '100%', padding: '8px 10px', fontSize: 14,
    background: t.input, color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 6,
    ...extra,
  };
}

function pagerStyle(t, disabled) {
  return {
    padding: '5px 10px', fontSize: 13, fontWeight: 600,
    background: 'transparent', color: disabled ? t.border : t.text,
    border: `1px solid ${t.border}`, borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

function btnStyle(bg, disabled = false, color = '#fff', border) {
  return {
    padding: '10px 18px', fontSize: 14, fontWeight: 700,
    background: disabled ? '#6c757d' : bg, color: disabled ? '#fff' : color,
    border: border ? `1px solid ${border}` : 'none', borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
