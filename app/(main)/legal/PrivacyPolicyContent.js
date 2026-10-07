// The privacy policy text, shared by the /trawl/privacypolicy page and the
// pop-up opened from the YouTube sign-in box (YouTubeAuthPanel). Keep this the
// single source so the page and the modal can never drift apart.
//
// It covers every feature that uses the Google OAuth client 445744508174 —
// Trawl, Listogs and RipTag — and the items YouTube's Developer Policies
// require (III.A.2): YouTube API Services notice, Google Privacy Policy link,
// what is accessed/stored/shared, cookies, revocation, deletion and contact.

export const PRIVACY_LAST_UPDATED = 'October 6, 2026';

const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';
const GOOGLE_PERMISSIONS = 'https://security.google.com/settings/security/permissions';
const YOUTUBE_TERMS = 'https://www.youtube.com/t/terms';
const USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy';
const CONTACT = 'martinbarker99@gmail.com';

const Ext = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

export default function PrivacyPolicyContent() {
  return (
    <>
      <p>
        This Privacy Policy explains what information is accessed, stored and shared by the music tools that
        Martin Barker operates on <strong>martinbarker.me</strong>, and the choices you have. It covers:
      </p>
      <ul>
        <li><strong>Trawl</strong>, a Discord bot (with its results pages on martinbarker.me and bot.martinbarker.me) that adds YouTube links shared in Discord channels to a YouTube playlist;</li>
        <li><strong>Listogs</strong> (martinbarker.me/listogs), which turns a Discogs release, label or artist into a YouTube playlist; and</li>
        <li><strong>RipTag</strong> (martinbarker.me/riptag), which renders audio and cover art into a video and uploads it to YouTube.</li>
      </ul>
      <p>
        Together these are the &quot;Services&quot;. It applies alongside our{' '}
        <a href="/trawl/termsofservice">Terms of Service</a>.
      </p>

      <h2>1. We use YouTube API Services</h2>
      <p>
        The Services use <strong>YouTube API Services</strong> to create playlists, add videos to playlists and
        upload videos on your behalf. When you connect YouTube, your information is also handled by Google
        under the <Ext href={GOOGLE_PRIVACY}>Google Privacy Policy</Ext>, and your use of YouTube is governed
        by the <Ext href={YOUTUBE_TERMS}>YouTube Terms of Service</Ext>.
      </p>

      <h2>2. What we access from your YouTube account</h2>
      <p>
        Signing in with Google asks for one permission, <code>youtube.force-ssl</code>, shown by Google as
        &quot;See, edit, and permanently delete your YouTube videos, ratings, comments and captions&quot;. We
        use it only for the actions listed below. We never delete videos, rate videos, or read or post
        comments or captions.
      </p>
      <ul>
        <li>
          <strong>Trawl</strong>: reads your channel&apos;s name and ID (to show which account is connected),
          lists your playlists (so you can pick one), reads the items in the playlist you choose (to skip
          videos already in it), creates a playlist if you ask it to, and adds the videos found in your Discord
          channels to it.
        </li>
        <li>
          <strong>Listogs</strong>: creates a playlist with the title, description and privacy setting you
          enter (or uses an existing playlist you paste), then adds the release&apos;s videos to it.
        </li>
        <li>
          <strong>RipTag</strong>: uploads the video you rendered, with the title, description, tags and privacy
          setting you choose, and sets the thumbnail you pick.
        </li>
      </ul>

      <h2>3. Other information we process</h2>
      <ul>
        <li>
          <strong>Discord (Trawl)</strong>: music links posted in the channels a server admin selects, with the
          message and channel IDs and the poster&apos;s Discord user ID needed to build the playlist. The bot
          does not read channels it was not pointed at, or direct messages.
        </li>
        <li>
          <strong>Discogs (Listogs, RipTag)</strong>: release and tracklist data you look up. If you sign in to
          Discogs, its token is kept in your browser.
        </li>
        <li>
          <strong>Files (RipTag)</strong>: audio and images are processed in your browser. To upload, the
          finished video is sent through our server straight to YouTube. It is held in memory only for the
          upload and is not saved.
        </li>
      </ul>

      <h2>4. Where your YouTube sign-in is stored</h2>
      <ul>
        <li>
          <strong>martinbarker.me (Listogs, RipTag)</strong>: your Google access and refresh tokens are kept in
          your browser&apos;s local storage and in a server-side session identified by a session cookie. They
          are not written to any database.
        </li>
        <li>
          <strong>Trawl</strong>: your refresh token is stored encrypted (AES-256-GCM) in Trawl&apos;s database,
          with your YouTube channel name and ID, keyed to your Discord user ID. Trawl also stores scan results
          (the links found and their Discord message IDs) and your playlist settings, so it can add new videos
          on the schedule you set.
        </li>
      </ul>

      <h2>5. Cookies and local storage</h2>
      <p>
        martinbarker.me uses one session cookie to keep you signed in while you use a tool, and your
        browser&apos;s local storage to remember your YouTube and Discogs sign-ins and preferences such as dark
        mode. We do not use advertising or analytics cookies, and we do not track you across other sites.
      </p>

      <h2>6. How we use and share information</h2>
      <p>
        We use this information only to provide the features you ask for. We do not sell it, use it for
        advertising, or share it with anyone except the services needed to perform your request (Google/YouTube,
        Discord and Discogs) and our hosting provider (Amazon Web Services), or where required by law. Our use of
        information received from Google APIs follows the{' '}
        <Ext href={USER_DATA_POLICY}>Google API Services User Data Policy</Ext>, including the Limited Use
        requirements.
      </p>

      <h2>7. Revoking access</h2>
      <ul>
        <li>
          Click <strong>Sign out</strong> in the YouTube box on Listogs or RipTag, or <strong>Sign out</strong> in
          Trawl. This revokes our access at Google and deletes the stored sign-in.
        </li>
        <li>
          At any time, remove access from your Google Account&apos;s security settings:{' '}
          <Ext href={GOOGLE_PERMISSIONS}>{GOOGLE_PERMISSIONS}</Ext>.
        </li>
        <li>Remove the Trawl bot from your Discord server to stop it reading that server&apos;s messages.</li>
      </ul>

      <h2>8. Data retention and deletion</h2>
      <ul>
        <li>
          <strong>martinbarker.me</strong>: signing out deletes your tokens from the server session and your
          browser immediately. Server sessions are kept in memory only and end when the session ends or the
          server restarts.
        </li>
        <li>
          <strong>Trawl</strong>: signing out deletes your stored token immediately. If you revoke access from
          your Google Account instead, the stored token stops working at once and can no longer access your
          account. Click Sign out in Trawl or email us to remove it from the database as well.
        </li>
        <li>
          <strong>On request</strong>: email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> to delete any data
          linked to your YouTube account, Discord account or server, including Trawl scan results. We do it
          within 7 days and confirm by email.
        </li>
        <li>Videos and playlists created in your YouTube account stay there until you remove them on YouTube.</li>
      </ul>

      <h2>9. Security</h2>
      <p>
        Tokens are sent only over HTTPS. Trawl encrypts stored tokens, and martinbarker.me does not store them
        in a database. No method of transmission or storage is completely secure, so we cannot guarantee
        absolute security.
      </p>

      <h2>10. Children</h2>
      <p>
        The Services are not directed to children under 13 (or the minimum age to use YouTube or Discord where
        you live), and we do not knowingly collect their information.
      </p>

      <h2>11. Changes to this policy</h2>
      <p>
        If we change this policy, we will update the &quot;Last updated&quot; date above. Continuing to use the
        Services after a change means you accept the updated policy.
      </p>

      <h2>12. Contact</h2>
      <p>
        For privacy questions or data requests, email Martin Barker at{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </>
  );
}
