'use client';
/* eslint-disable @next/next/no-img-element */
import React, { useMemo, useState } from 'react';
import styles from './media2gif.module.css';

const FLAGS = [
  { flag: '--movie', arg: 'PATH', desc: 'Path to the movie file', req: true },
  { flag: '--subtitles', arg: 'PATH', desc: 'External .srt subtitle file (optional — embedded tracks auto-detected)' },
  { flag: '--outputFolder', arg: 'DIR', desc: 'Where the GIFs land. Relative paths sit next to the movie.' },
  { flag: '--interval', arg: 'SEC', desc: 'Seconds between non-quote GIFs', def: '5' },
  { flag: '--startTime', arg: 'hh:mm:ss', desc: 'When to start scanning', def: '00:00:00' },
  { flag: '--maxFilesize', arg: 'SIZE', desc: 'Target size, e.g. 15mb. Script downsamples until it fits.' },
  { flag: '--quotes', arg: 'BOOL', desc: 'Include subtitle quotes burned into GIFs', def: 'true' },
  { flag: '--randomQuote', arg: '', desc: 'Pick a random quote (or random time if --quotes false)' },
  { flag: '--randomTimes', arg: '', desc: 'Generate from random start times rather than walking the film' },
  { flag: '--subtitleColor', arg: 'COLOR', desc: 'Subtitle text color', def: 'white' },
  { flag: '--subtitleSize', arg: 'PX', desc: 'Subtitle font size', def: '16' },
  { flag: '--textBorder', arg: 'PX', desc: 'Black stroke width around text', def: '2' },
  { flag: '--textPadding', arg: 'PX', desc: 'Margin so text never crops', def: '5' },
  { flag: '--bottomPadding', arg: 'PX', desc: 'Distance from bottom of frame' },
  { flag: '--uppercase', arg: '', desc: 'Force ALL CAPS subtitles' },
  { flag: '--italicize', arg: '', desc: 'Italicize subtitle text', def: 'false' },
  { flag: '--trailingPeriod', arg: 'BOOL', desc: 'Keep trailing periods in quotes', def: 'true' },
  { flag: '--noHDR', arg: '', desc: 'Convert HDR source to SDR before encoding' },
  { flag: '--boostColors', arg: 'PCT', desc: 'Boost saturation/contrast on the whole GIF' },
  { flag: '--boostFrameColors', arg: 'PCT', desc: 'Boost colors per-frame before assembly' },
  { flag: '--saveJson', arg: '', desc: 'Write a sidecar JSON with quote, start, end, filename' },
  { flag: '--outputBatchFolderSize', arg: 'N', desc: 'Auto-bucket into batch_001, batch_002… every N gifs' },
  { flag: '--listSubtitleTracks', arg: '', desc: 'Print embedded subtitle tracks and exit' },
  { flag: '--subtitleTrack', arg: 'INDEX', desc: 'Pick which embedded track to burn in' },
  { flag: '--debug', arg: '', desc: 'Save every iteration of the size-optimization loop' },
];

const MOVIES = [
  { title: 'The Avengers', year: 2012 },
  { title: 'Star Wars: Episode III — Revenge of the Sith', year: 2005 },
  { title: 'Back to the Future', year: 1985 },
];

export default function Media2GifClient({ gifs }) {
  const movieFilters = useMemo(() => {
    const set = new Set(gifs.map((g) => g.movie));
    return ['All', ...set];
  }, [gifs]);
  const [filter, setFilter] = useState('All');
  const filtered = useMemo(
    () => gifs.filter((g) => filter === 'All' || g.movie === filter),
    [gifs, filter]
  );

  const [flagQuery, setFlagQuery] = useState('');
  const flagsFiltered = FLAGS.filter(
    (f) => !flagQuery || f.flag.toLowerCase().includes(flagQuery.toLowerCase()) || f.desc.toLowerCase().includes(flagQuery.toLowerCase())
  );

  const [os, setOs] = useState('macos');
  const ffmpegInstall = {
    macos: `# install Homebrew, then:\nbrew install ffmpeg`,
    linux: `sudo apt update\nsudo apt install ffmpeg`,
    windows: `# download from ffmpeg.org/download.html\n# extract, then add the bin/ folder to PATH`,
  };
  const venvInstall = {
    macos: `python3 -m venv venv\nsource venv/bin/activate\npip install -r requirements.txt`,
    linux: `python3 -m venv venv\nsource venv/bin/activate\npip install -r requirements.txt`,
    windows: `python -m venv venv\n.\\venv\\Scripts\\activate\npip install -r requirements.txt`,
  };

  const totalGifs = gifs.length;
  const quotedGifs = gifs.filter((g) => g.quote).length;
  const totalDurSec = gifs.reduce((sum, g) => sum + g.durSec, 0);
  const totalDurMin = Math.round(totalDurSec / 60);

  return (
    <div className={`${styles.page} ${styles.dark}`}>
      {/* ============ HERO ============ */}
      <section className={styles.hero}>
        <div className={styles.wrap}>
          <div className={styles.heroBrand}>
            <img src="/ico/media2gif_icon.png" alt="Media2Gif" className={styles.heroBrandIcon} />
            <span className={styles.heroBrandWord}>Media2Gif</span>
          </div>
          <div className={styles.heroEyebrow}>
            <span className={styles.dot} />
            <span className={styles.mono}>v2.4 · OPEN SOURCE</span>
          </div>
          <h1 className={styles.heroH1}>
            Turn any film into a wall of <em>perfectly tagged</em> GIFs.
          </h1>
          <p className={styles.heroSub}>
            Media2Gif is a command-line tool that walks through a movie file, finds every quote in
            the subtitles, and exports a GIF for each one — sized to fit Giphy with the line burned
            in. Run it once and you have hundreds of upload-ready clips, every filename already
            encoding the movie, timestamp, and quote.
          </p>
          <div className={styles.heroCta}>
            <a className={`${styles.btn} ${styles.btnPrimary}`} href="https://giphy.com/channel/media2gif" target="_blank" rel="noreferrer">
              Browse on Giphy
              <svg className={styles.arrow} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a className={`${styles.btn} ${styles.btnGhost}`} href="https://github.com/MartinBarker/Media2Gif" target="_blank" rel="noreferrer">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.34c-2.22.48-2.69-1.07-2.69-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.13 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.11.16 1.93.08 2.13.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.94.29.25.54.74.54 1.49v2.21c0 .21.15.46.55.38A8 8 0 0 0 8 0z" />
              </svg>
              Star on GitHub
            </a>
          </div>
          <div className={styles.heroMeta}>
            <span><i className={styles.tick} />Auto size-targeting (under 4 MB by default)</span>
            <span><i className={styles.tick} />SRT + embedded subtitle tracks</span>
            <span><i className={styles.tick} />Filenames pre-tagged for Giphy</span>
          </div>
        </div>
      </section>

      {/* ============ STATS ============ */}
      <div className={styles.stats}>
        <div className={styles.wrap}>
          <div className={styles.statsGrid}>
            <div className={styles.stat}>
              <div className={styles.statNum}>{totalGifs.toLocaleString()}</div>
              <div className={styles.statLabel}>GIFs in this gallery</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>{quotedGifs.toLocaleString()}</div>
              <div className={styles.statLabel}>Quotes captured</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>{totalDurMin}<small>min</small></div>
              <div className={styles.statLabel}>Of footage processed</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>3.7<small>MB</small></div>
              <div className={styles.statLabel}>Average GIF size</div>
            </div>
          </div>
        </div>
      </div>

      {/* ============ MOVIES ============ */}
      <section className={styles.section} id="movies">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionEyebrow}>// 02. CORPUS</div>
              <h2 className={styles.sectionTitle}>Films fully converted.</h2>
            </div>
            <p className={styles.sectionDesc}>
              Every quote from these films has been processed end-to-end and uploaded to the
              Media2Gif Giphy channel. More on the way.
            </p>
          </div>

          <div className={styles.moviesGrid}>
            {MOVIES.map((m, i) => (
              <a
                className={styles.movieCard}
                key={i}
                href="https://giphy.com/channel/media2gif"
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className={styles.moviePoster}>
                  <div className={styles.title}>{m.title}</div>
                </div>
                <div className={styles.movieFoot}>
                  <span>{m.year}</span>
                  <span className={styles.gifs}>fully converted</span>
                </div>
              </a>
            ))}
            <div className={`${styles.movieCard} ${styles.movieCardSoon}`}>
              <div className={styles.moviePoster}>
                <div className={styles.title}>More films<br />coming soon.</div>
              </div>
              <div className={styles.movieFoot}>
                <span>queued</span>
                <span className={styles.gifs}>in progress</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ GALLERY ============ */}
      <section className={styles.section} id="gallery">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionEyebrow}>// 03. THE OUTPUT</div>
              <h2 className={styles.sectionTitle}>A wall of moments, ready to share.</h2>
            </div>
            <p className={styles.sectionDesc}>
              Every card is a generated GIF — quote burned in, file under 4&nbsp;MB, name pre-tagged.
              Filter by film. Drop your own corpus in and the wall keeps growing.
            </p>
          </div>

          <div className={styles.galleryControls}>
            {movieFilters.map((m) => (
              <button
                key={m}
                className={`${styles.chip} ${filter === m ? styles.chipActive : ''}`}
                onClick={() => setFilter(m)}
              >
                {m}
              </button>
            ))}
          </div>

          <div className={styles.wall}>
            {filtered.map((g, i) => {
              const tagCount = 4 + ((i * 3) % 7);
              return (
                <a
                  key={g.file}
                  className={styles.gifCard}
                  href={`/gifs/${encodeURIComponent(g.file)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className={styles.gifFrame}>
                    <img src={`/gifs/${encodeURIComponent(g.file)}`} alt={g.quote || `${g.movie} ${g.startLabel}`} loading="lazy" />
                    <span className={styles.gifFrameLabel}>{`${g.movie} · ${g.year}`}</span>
                    <span className={styles.gifFrameDur}>{g.durLabel}</span>
                  </div>
                  {g.quote && <div className={styles.gifQuote}>{g.quote}</div>}
                  <div className={styles.gifMeta}>
                    <span className={styles.timestamp}>{g.startLabel}</span>
                    <span className={styles.tagCount}>{tagCount} tags</span>
                  </div>
                </a>
              );
            })}
          </div>
          <div className={styles.wallFade}>— {filtered.length} of {totalGifs} shown —</div>

          <div className={styles.giphyStrip}>
            <div className={styles.left}>
              <span className={styles.badge}>Giphy ready</span>
              <p className={styles.giphyCopy}>
                <strong>Filenames are the upload form.</strong> Each GIF saves as
                {' '}<span className={styles.mono}>Heat-Start[00-12-04]-End[00-12-08]-Quote[dontletyourselfgetattached].gif</span>,
                so the title, timestamp, and quote populate themselves on upload.
              </p>
            </div>
            <a
              className={`${styles.btn} ${styles.btnPrimary}`}
              href="https://giphy.com/channel/media2gif"
              target="_blank"
              rel="noreferrer"
            >
              View Giphy channel
              <svg className={styles.arrow} width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* ============ PIPELINE ============ */}
      <section className={`${styles.section} ${styles.sectionAlt}`} id="how">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionEyebrow}>// 04. THE PIPELINE</div>
              <h2 className={styles.sectionTitle}>From .mkv to gallery in five passes.</h2>
            </div>
            <p className={styles.sectionDesc}>
              The script reads your subtitle track, walks the timeline at your interval, and
              re-encodes each clip in a tightening loop until it lands inside your size budget.
            </p>
          </div>

          <div className={styles.pipeline}>
            <div className={styles.step}>
              <div className={styles.stepIcon}>01</div>
              <div className={styles.stepNum}>INGEST</div>
              <h3 className={styles.stepTitle}>Read the film</h3>
              <p className={styles.stepBody}>ffprobe inspects the source. External SRT or embedded track, your call. HDR sources can be flattened with --noHDR.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepIcon}>02</div>
              <div className={styles.stepNum}>SCAN</div>
              <h3 className={styles.stepTitle}>Walk the timeline</h3>
              <p className={styles.stepBody}>Step through at --interval seconds. If the slice contains a quote, expand to the full line. Otherwise capture a 5-second clip.</p>
            </div>
            <div className={`${styles.step} ${styles.stepBurn}`}>
              <div className={styles.stepIcon}>03</div>
              <div className={styles.stepNum}>BURN</div>
              <h3 className={styles.stepTitle}>Stamp the quote</h3>
              <p className={styles.stepBody}>Subtitle gets typeset to your color, size, stroke, and padding. ALL CAPS or italic if you want. Cropped-safe by design.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepIcon}>04</div>
              <div className={styles.stepNum}>FIT</div>
              <h3 className={styles.stepTitle}>Squeeze under budget</h3>
              <p className={styles.stepBody}>Iterative re-encode: tweak palette, framerate, and scale until the file lands as close to --maxFilesize as possible.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepIcon}>05</div>
              <div className={styles.stepNum}>EMIT</div>
              <h3 className={styles.stepTitle}>Tag and save</h3>
              <p className={styles.stepBody}>Filename encodes movie, start, end, and sanitized quote. Sidecar JSON optional. Auto-bucketing into batch_NNN folders.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ CLI ============ */}
      <section className={styles.section} id="cli">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionEyebrow}>// 05. THE INTERFACE</div>
              <h2 className={styles.sectionTitle}>25 flags. One command.</h2>
            </div>
            <p className={styles.sectionDesc}>
              Subtitle styling, size targeting, batch organization, randomization, and HDR handling
              all live behind clearly-named flags. Sensible defaults — opinionated where it matters.
            </p>
          </div>

          <div className={styles.cliGrid}>
            <div>
              <div className={styles.terminal}>
                <div className={styles.terminalBar}>
                  <span className={styles.dot} /><span className={styles.dot} /><span className={styles.dot} />
                  <span className={styles.title}>~/projects/media2gif — bash</span>
                </div>
                <div className={styles.terminalBody}>
                  <div className={styles.termLine}><span className={styles.termComment}># generate gifs for every quote in the film</span></div>
                  <div className={styles.termLine}><span className={styles.termPrompt}>$</span> python make_gifs.py <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--movie</span> <span className={styles.termVal}>{'"Heat.mp4"'}</span> <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--outputFolder</span> <span className={styles.termVal}>gifs</span> <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--maxFilesize</span> <span className={styles.termVal}>{'"15mb"'}</span> <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--quotes</span> <span className={styles.termVal}>true</span> <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--subtitleColor</span> <span className={styles.termVal}>{'"white"'}</span> <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--subtitleSize</span> <span className={styles.termVal}>35</span> <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--textBorder</span> <span className={styles.termVal}>3</span> <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--uppercase</span> <span className={styles.termCont}>\</span></div>
                  <div className={styles.termLine}>{'  '}<span className={styles.termFlag}>--saveJson</span></div>
                  <div className={styles.termLine} style={{ marginTop: 14 }}><span className={styles.termComment}>{'→ Heat-Start[00-12-04]-End[00-12-08]-Quote[dontletyourselfgetattached].gif  3.92 MB'}</span></div>
                  <div className={styles.termLine}><span className={styles.termComment}>{'→ Heat-Start[00-18-22]-End[00-18-25]-Quote[theactionisthejuice].gif         3.88 MB'}</span></div>
                  <div className={styles.termLine}><span className={styles.termComment}>{'→ Heat-Start[00-24-11]-End[00-24-15]-Quote[aguytoldmeoncedontletyou].gif    3.95 MB'}</span></div>
                  <div className={styles.termLine}><span className={styles.termComment}>{'→ Heat-Start[00-31-58]-End[00-32-02]-Quote[iamaloneIamnotlonely].gif        3.91 MB'}</span></div>
                  <div className={styles.termLine} style={{ marginTop: 8 }}><span className={styles.termComment}>[OK] 142 gifs · 9,604 quotes · 3.7 MB avg</span></div>
                </div>
              </div>
            </div>

            <div>
              <div className={styles.flagsSearch}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" style={{ color: 'var(--ink-3)' }}>
                  <circle cx="6" cy="6" r="4.5" strokeWidth="1.3" />
                  <path d="M9.5 9.5l3 3" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <input placeholder="filter flags…" value={flagQuery} onChange={(e) => setFlagQuery(e.target.value)} />
                <span className={styles.key}>/</span>
              </div>
              <div className={styles.flagsScroll}>
                <table className={styles.flagsTable}>
                  <thead>
                    <tr>
                      <th>Flag</th><th>Default</th><th>What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagsFiltered.map((f, i) => (
                      <tr key={i}>
                        <td className={`${styles.flag} ${f.req ? styles.req : ''}`}>
                          {f.flag}
                          {f.arg && <span className={styles.arg}>&lt;{f.arg}&gt;</span>}
                        </td>
                        <td className={styles.def}>{f.def || '—'}</td>
                        <td className={styles.desc}>{f.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ INSTALL ============ */}
      <section className={`${styles.section} ${styles.sectionAlt}`} id="install">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionEyebrow}>// 06. QUICKSTART</div>
              <h2 className={styles.sectionTitle}>Three steps. Five minutes.</h2>
            </div>
            <p className={styles.sectionDesc}>
              ffmpeg does the encoding. Python orchestrates. Clone, install, point it at a movie.
            </p>
          </div>

          <div className={styles.osTabs}>
            {[['macos', 'macOS'], ['linux', 'Linux'], ['windows', 'Windows']].map(([k, l]) => (
              <button
                key={k}
                className={`${styles.osTab} ${os === k ? styles.osTabActive : ''}`}
                onClick={() => setOs(k)}
              >
                {l}
              </button>
            ))}
          </div>

          <div className={styles.installGrid}>
            <div className={styles.installCard}>
              <h3><span className={styles.num}>01</span>Install ffmpeg</h3>
              <pre className={styles.codeBlock}>{ffmpegInstall[os]}</pre>
            </div>
            <div className={styles.installCard}>
              <h3><span className={styles.num}>02</span>Clone &amp; venv</h3>
              <pre className={styles.codeBlock}>{`git clone https://github.com/MartinBarker/Media2Gif\ncd Media2Gif\n\n${venvInstall[os]}`}</pre>
            </div>
            <div className={styles.installCard}>
              <h3><span className={styles.num}>03</span>Run it</h3>
              <pre className={styles.codeBlock}>{`python make_gifs.py \\\n  --movie "movie.mkv" \\\n  --outputFolder gifs \\\n  --maxFilesize "15mb" \\\n  --uppercase \\\n  --saveJson`}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className={styles.footer}>
        <div className={styles.wrap}>
          <div className={styles.footerGrid}>
            <div>
              <div className={styles.footerBrand}>
                <img src="/ico/media2gif_icon.png" alt="" className={styles.footerBrandIcon} />
                Media2Gif
              </div>
              <p style={{ color: 'var(--ink-2)', fontSize: 14, maxWidth: '32ch', margin: 0, lineHeight: 1.55 }}>
                An open-source command-line tool for batch-generating perfectly tagged movie GIFs.
                Built for archivists, editors, and anyone who lives in a quote.
              </p>
            </div>
            <div>
              <h4>Project</h4>
              <ul>
                <li><a href="https://github.com/MartinBarker/Media2Gif">GitHub</a></li>
                <li><a href="https://github.com/MartinBarker/Media2Gif/issues">Issues</a></li>
                <li><a href="https://github.com/MartinBarker/Media2Gif/releases">Releases</a></li>
              </ul>
            </div>
            <div>
              <h4>Docs</h4>
              <ul>
                <li><a href="#install">Install</a></li>
                <li><a href="#cli">CLI flags</a></li>
                <li><a href="#how">How it works</a></li>
              </ul>
            </div>
            <div>
              <h4>Made with</h4>
              <ul>
                <li><a href="https://ffmpeg.org">ffmpeg</a></li>
                <li><a href="https://python.org">Python 3</a></li>
                <li><a href="https://giphy.com">Giphy</a></li>
              </ul>
            </div>
          </div>
          <div className={styles.footerBottom}>
            <span>MEDIA2GIF · BUILT BY MARTIN BARKER</span>
            <span>© 2026 — NOT AFFILIATED WITH ANY FILM STUDIO OR PLATFORM</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
