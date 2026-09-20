// Showcase page for the Discogs Theme Generator extension. Deliberately short:
// what it does, how to get it, how to start it. The build/VSIX/publish steps
// from the repo's README are developer notes and stay in the repo.
import styles from "./discogs-theme-generator.module.css";

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=MartinBarker.discogs-theme-generator";

export const metadata = {
  title: "Discogs Theme Generator - VS Code & Cursor Extension",
  description:
    "A VS Code and Cursor extension that pulls a random vinyl release from Discogs, "
    + "extracts the colours from its cover, and applies them to your editor.",
  alternates: { canonical: "https://martinbarker.me/discogs-theme-generator" },
  openGraph: {
    title: "Discogs Theme Generator - VS Code & Cursor Extension",
    description:
      "Generate editor colour themes from Discogs album art. Pick a random vinyl "
      + "release, extract its cover colours, and apply the palette to your editor.",
    url: "https://martinbarker.me/discogs-theme-generator",
    type: "website",
  },
};

const FEATURES = [
  {
    title: "Randomly Refresh Discogs Theme",
    body: "Fetches a random vinyl release and builds a theme from its album art.",
  },
  {
    title: "Generate Random",
    body: "Random colour palettes without touching Discogs at all.",
  },
  {
    title: "History",
    body: "Browse every theme you have had and reload any of them.",
  },
  {
    title: "Auto-refresh",
    body: "Optionally re-theme on an interval, or each time a workspace opens.",
  },
  {
    title: "Scope",
    body: "Apply a theme to just this window, or to every window at once.",
  },
];

const STEPS = [
  <>Install it from the <a className={styles.inlineLink} href={MARKETPLACE_URL}
    target="_blank" rel="noopener noreferrer">VS&nbsp;Code Marketplace</a>.</>,
  <>Press <kbd className={styles.kbd}>Ctrl</kbd>+<kbd className={styles.kbd}>Shift</kbd>+<kbd className={styles.kbd}>P</kbd>{" "}
    (<kbd className={styles.kbd}>Cmd</kbd>+<kbd className={styles.kbd}>Shift</kbd>+<kbd className={styles.kbd}>P</kbd> on
    a Mac) and run <span className={styles.cmd}>Open Discogs Theme Generator</span>.</>,
  <>Click <span className={styles.cmd}>Randomly Refresh Discogs Theme</span>. A release is
    fetched and its colours become your theme.</>,
];

export default function DiscogsThemeGeneratorPage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Discogs Theme Generator</h1>
        <p className={styles.tagline}>
          Generate editor colour themes from Discogs album art. Pick a random vinyl
          release, extract the colours from its cover, and apply the palette to your editor.
        </p>
        <div className={styles.ctaRow}>
          <a className={styles.cta} href={MARKETPLACE_URL} target="_blank" rel="noopener noreferrer">
            Get it on the VS Code Marketplace
          </a>
          <span className={styles.worksIn}>
            Works in VS&nbsp;Code, Cursor, and any editor that supports VS&nbsp;Code extensions.
          </span>
        </div>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Quick start</h2>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>What it does</h2>
        <ul className={styles.features}>
          {FEATURES.map(f => (
            <li key={f.title} className={styles.feature}>
              <span className={styles.featureTitle}>{f.title}</span>
              <span className={styles.featureBody}>{f.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.footNote}>
        Requires VS&nbsp;Code 1.85+ or any recent version of Cursor.
      </p>
    </div>
  );
}
