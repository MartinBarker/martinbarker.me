/* eslint-disable @next/next/no-img-element */
'use client'
import React, { useState } from 'react';
import styles from './discord2playlist.module.css';

const INVITE_URL = 'https://discord.com/oauth2/authorize?client_id=1523803465095315659&permissions=67584&integration_type=0&scope=bot+applications.commands';
const APP_ICON = '/images/discord2playlist-icons/groove-app-icon-512.png';
const CIRCLE_ICON = '/images/discord2playlist-icons/groove-circle-512.png';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      type="button"
      onClick={handle}
      className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`}
    >
      {copied ? (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Copied
        </>
      ) : 'Copy'}
    </button>
  );
}

export default function Trawl() {
  const makeplaylistsCmd = '/makeplaylists input_channel:#music-share output_channel:#debug_out save_json:True';
  const installCmd = `npm i
node deploy_discord_commands.js
node start_discord_bot.js`;
  const youtubeCmd = 'node add_to_youtube_playlist.js';

  return (
    <div className={styles.page} id="top">
      <nav className={styles.nav}>
        <div className={`${styles.wrap} ${styles.navInner}`}>
          <a className={styles.brand} href="#top">
            <img src={APP_ICON} alt="Trawl icon" />
            <span className={styles.bname}>Trawl</span>
          </a>
          <div className={styles.navLinks}>
            <a className={styles.lnk} href="#how">How it works</a>
            <a className={styles.lnk} href="#commands">Commands</a>
            <a className={styles.lnk} href="#setup">Setup</a>
            <a className={`${styles.btn} ${styles.btnPrimary}`} href={INVITE_URL} target="_blank" rel="noopener noreferrer">Invite the bot</a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <header className={styles.hero}>
        <div className={`${styles.wrap} ${styles.heroGrid}`}>
          <div>
            <span className={styles.eyebrow}>
              <span className={styles.live}></span>Discord → YouTube playlists
            </span>
            <h1 className={styles.heroTitle}>
              Every link your server shares, <span className={styles.em}>spun into one playlist.</span>
            </h1>
            <p className={styles.heroSub}>
              Trawl reads the music posted in a Discord channel and turns it into a single YouTube playlist — with one slash command.
            </p>
            <div className={styles.heroCta}>
              <a className={`${styles.btn} ${styles.btnPrimary}`} href={INVITE_URL} target="_blank" rel="noopener noreferrer">
                <img className={styles.mk} src={CIRCLE_ICON} alt="" />Invite the bot
              </a>
              <a className={`${styles.btn} ${styles.btnGhost}`} href="#commands">See the commands</a>
            </div>
            <div className={styles.heroNote}>
              <span><span className={styles.tick}>✓</span> Free &amp; open source</span>
              <span><span className={styles.tick}>✓</span> One slash command</span>
              <span><span className={styles.tick}>✓</span> JSON export</span>
            </div>
          </div>
          <div className={styles.iconStage}>
            <img className={styles.iconHero} src={APP_ICON} alt="Trawl app icon" />
            <div className={`${styles.chipFloat} ${styles.cf1}`}><span className={styles.yt}></span>youtu.be/dQw4…</div>
            <div className={`${styles.chipFloat} ${styles.cf2}`}><span className={styles.yt}></span>added to playlist</div>
          </div>
        </div>
      </header>

      {/* HOW */}
      <section className={styles.section} id="how">
        <div className={styles.wrap}>
          <div className={styles.secHead}>
            <p className={styles.secKicker}>How it works</p>
            <h2 className={styles.secTitle}>From a channel full of links to a finished playlist in three steps.</h2>
          </div>
          <div className={styles.steps}>
            <div className={styles.step}>
              <div className={styles.stepNum}><span className={styles.ring}>1</span>Invite</div>
              <h3>Add the bot</h3>
              <p>Invite Trawl to your server. It only needs <em>Send Messages</em> and <em>Read Message History</em>.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepNum}><span className={styles.ring}>2</span>Run</div>
              <h3>Point it at a channel</h3>
              <p>Run <code>/makeplaylists</code> with your music channel. It scans every media message and collects the links.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepNum}><span className={styles.ring}>3</span>Done</div>
              <h3>Get your playlist</h3>
              <p>Links are pushed straight into your YouTube playlist — or saved as a clean JSON file you can keep.</p>
            </div>
          </div>
        </div>
      </section>

      {/* COMMANDS */}
      <section className={`${styles.section} ${styles.alt}`} id="commands">
        <div className={styles.wrap}>
          <div className={styles.secHead}>
            <p className={styles.secKicker}>Commands</p>
            <h2 className={styles.secTitle}>Copy, paste, run.</h2>
          </div>

          <div className={styles.cmdStack}>
            <p className={styles.cmdLabel}>
              <span className={`${styles.badge} ${styles.badgeDiscord}`}>In Discord</span>
              Build a playlist from a channel
            </p>
            <div className={styles.cmd}>
              <div className={styles.cmdTop}>
                <span className={`${styles.dot} ${styles.d1}`}></span>
                <span className={`${styles.dot} ${styles.d2}`}></span>
                <span className={`${styles.dot} ${styles.d3}`}></span>
                <span className={styles.ttl}>slash command · #music-share</span>
              </div>
              <div className={styles.cmdBody}>
                <pre>
                  <span className={styles.slash}>/makeplaylists</span>{' '}
                  <span className={styles.arg}>input_channel:</span><span className={styles.val}>#music-share</span>{' '}
                  <span className={styles.arg}>output_channel:</span><span className={styles.val}>#debug_out</span>{' '}
                  <span className={styles.arg}>save_json:</span><span className={styles.val}>True</span>
                </pre>
                <CopyButton text={makeplaylistsCmd} />
              </div>
            </div>

            <div className={styles.argsNote}>
              <div className={styles.argCard}>
                <div className={styles.argKey}>input_channel</div>
                <div className={styles.argVal}>The channel to read media links from.</div>
              </div>
              <div className={styles.argCard}>
                <div className={styles.argKey}>output_channel</div>
                <div className={styles.argVal}>Where the bot posts its progress &amp; results.</div>
              </div>
              <div className={styles.argCard}>
                <div className={styles.argKey}>save_json</div>
                <div className={styles.argVal}>Set <b>True</b> to also export a JSON file of every media message.</div>
              </div>
            </div>
          </div>

          <div className={styles.cmdStack} style={{ marginTop: 48 }}>
            <p className={styles.cmdLabel}>
              <span className={`${styles.badge} ${styles.badgeShell}`}>Self-host</span>
              Run your own instance
            </p>

            <div className={styles.cmd}>
              <div className={styles.cmdTop}>
                <span className={`${styles.dot} ${styles.d1}`}></span>
                <span className={`${styles.dot} ${styles.d2}`}></span>
                <span className={`${styles.dot} ${styles.d3}`}></span>
                <span className={styles.ttl}>bash · install &amp; deploy</span>
              </div>
              <div className={styles.cmdBody}>
                <pre>
                  <span className={styles.pr}>$ </span>npm i{'\n'}
                  <span className={styles.pr}>$ </span>node deploy_discord_commands.js  <span className={styles.cmt}># register slash commands</span>{'\n'}
                  <span className={styles.pr}>$ </span>node start_discord_bot.js        <span className={styles.cmt}># keep running for commands to work</span>
                </pre>
                <CopyButton text={installCmd} />
              </div>
            </div>

            <div className={styles.cmd}>
              <div className={styles.cmdTop}>
                <span className={`${styles.dot} ${styles.d1}`}></span>
                <span className={`${styles.dot} ${styles.d2}`}></span>
                <span className={`${styles.dot} ${styles.d3}`}></span>
                <span className={styles.ttl}>bash · push to YouTube</span>
              </div>
              <div className={styles.cmdBody}>
                <pre>
                  <span className={styles.pr}>$ </span>node add_to_youtube_playlist.js  <span className={styles.cmt}># adds the saved links to your playlist</span>
                </pre>
                <CopyButton text={youtubeCmd} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SETUP */}
      <section className={styles.section} id="setup">
        <div className={styles.wrap}>
          <div className={styles.secHead}>
            <p className={styles.secKicker}>One-time setup</p>
            <h2 className={styles.secTitle}>What you&apos;ll need before the first run.</h2>
          </div>
          <div className={styles.steps}>
            <div className={styles.step}>
              <div className={styles.stepNum}><span className={styles.ring}>1</span>Discord</div>
              <h3>Invite the bot</h3>
              <p>Use the invite button — it requests <em>Send Messages</em> and <em>Read Message History</em>, and enables the slash command.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepNum}><span className={styles.ring}>2</span>YouTube</div>
              <h3>Connect the API</h3>
              <p>Authorize the YouTube Data API v3 once and set your <code>YOUTUBE_PLAYLIST_ID</code> so the bot knows where to add tracks.</p>
            </div>
            <div className={styles.step}>
              <div className={styles.stepNum}><span className={styles.ring}>3</span>Go</div>
              <h3>Run /makeplaylists</h3>
              <p>Re-run any time to catch new links — your playlist stays current with whatever the server shares.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className={styles.section} style={{ paddingTop: 24 }}>
        <div className={styles.wrap}>
          <div className={styles.ctaBand}>
            <div className={styles.ghost}></div>
            <div className={`${styles.ghost} ${styles.ghostTwo}`}></div>
            <img src={APP_ICON} alt="Trawl icon" />
            <h2>Give your server a playlist that builds itself.</h2>
            <p>Add Trawl in under a minute and turn months of shared links into one playlist everyone can hit play on.</p>
            <a className={`${styles.btn} ${styles.btnPrimary}`} href={INVITE_URL} target="_blank" rel="noopener noreferrer">
              <img className={styles.mk} src={CIRCLE_ICON} alt="" style={{ width: 20, height: 20 }} />Invite the bot
            </a>
          </div>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footInner}`}>
          <div className={styles.footBrand}>
            <img src={APP_ICON} alt="" />
            <span className={styles.bname}>Trawl</span>
          </div>
          <div className={styles.footMeta}>
            Discord → YouTube playlist bot · open source
            <span className={styles.footLegal}>
              <a href="/trawl/termsofservice">Terms of Service</a>
              <span aria-hidden="true"> · </span>
              <a href="/trawl/privacypolicy">Privacy Policy</a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
