// The Terms of Service text, shared by the /trawl/termsofservice page and the
// pop-up opened from the YouTube sign-in box (YouTubeAuthPanel), so the two
// can never drift apart. Covers Trawl, Listogs and RipTag.

export const TERMS_LAST_UPDATED = 'October 6, 2026';

const YOUTUBE_TERMS = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';

const Ext = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
);

export default function TermsOfServiceContent() {
  return (
    <>
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of the music tools Martin Barker operates on{' '}
        <strong>martinbarker.me</strong>: the <strong>Trawl</strong> Discord bot and its results pages,{' '}
        <strong>Listogs</strong> (martinbarker.me/listogs) and <strong>RipTag</strong> (martinbarker.me/riptag),
        together the &quot;Services&quot;. By using the Services you agree to these Terms. If you do not agree,
        do not use the Services.
      </p>

      <h2>1. YouTube Terms of Service</h2>
      <p>
        The Services use YouTube API Services.{' '}
        <strong>
          By using the Services, you agree to be bound by the{' '}
          <Ext href={YOUTUBE_TERMS}>YouTube Terms of Service</Ext>
        </strong>
        . How Google handles your information is described in the{' '}
        <Ext href={GOOGLE_PRIVACY}>Google Privacy Policy</Ext>, and how we handle it is described in our{' '}
        <a href="/trawl/privacypolicy">Privacy Policy</a>.
      </p>

      <h2>2. What the Services do</h2>
      <ul>
        <li>
          <strong>Trawl</strong> collects the music links shared in the Discord channels you choose and adds the
          YouTube videos to a playlist in the YouTube account you connect.
        </li>
        <li><strong>Listogs</strong> creates a YouTube playlist from a Discogs release, label or artist.</li>
        <li>
          <strong>RipTag</strong> renders your audio and artwork into a video in your browser and uploads it to
          your YouTube channel with the details and thumbnail you choose.
        </li>
      </ul>
      <p>The Services are free and open source.</p>

      <h2>3. Eligibility and other platforms&apos; terms</h2>
      <p>
        You must be old enough to use YouTube, and Discord if you use Trawl, where you live. Trawl users must
        also follow the <Ext href="https://discord.com/terms">Discord Terms of Service</Ext> and{' '}
        <Ext href="https://discord.com/guidelines">Community Guidelines</Ext>, and need the right permissions
        (such as <code>Manage Server</code>) to add the bot to a server.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to use the Services to:</p>
      <ul>
        <li>break any law, or the terms of any other service, including YouTube, Discord and Discogs;</li>
        <li>upload content you do not have the rights to, or otherwise infringe anyone&apos;s intellectual property;</li>
        <li>spam, mislead, or post content YouTube&apos;s Community Guidelines do not allow; or</li>
        <li>abuse, overload, disrupt, or try to gain unauthorized access to the Services or their infrastructure.</li>
      </ul>

      <h2>5. Your content and accounts</h2>
      <p>
        Everything the Services create, such as playlists and uploaded videos, is created in your own YouTube
        account at your request, and you are responsible for it. You confirm you have the right to upload the
        audio and images you use in RipTag, and to change the playlists you connect. You can sign out or revoke
        access at any time, as described in the Privacy Policy.
      </p>

      <h2>6. Not affiliated with YouTube or Google</h2>
      <p>
        The Services are independent and are not affiliated with, endorsed by, or sponsored by YouTube, Google,
        Discord or Discogs.
      </p>

      <h2>7. Availability and changes</h2>
      <p>
        The Services are provided &quot;as is&quot; and &quot;as available&quot;. YouTube limits how many requests
        the Services can make each day, so a large playlist may take more than one day to finish. We may change,
        suspend or discontinue any part of the Services at any time. If we change these Terms, we will update the
        &quot;Last updated&quot; date above. Continuing to use the Services after a change means you accept the
        updated Terms.
      </p>

      <h2>8. Disclaimer of warranties</h2>
      <p>
        To the fullest extent the law allows, the Services come without warranties of any kind, express or
        implied, including fitness for a particular purpose and non-infringement. We do not promise the Services
        will be uninterrupted or error-free, or that any playlist or upload will be complete or accurate.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, the operator of the Services is not liable for any indirect,
        incidental, special, consequential or punitive damages, or any loss of data, arising from your use of
        the Services.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these Terms can be sent to{' '}
        <a href="mailto:martinbarker99@gmail.com">martinbarker99@gmail.com</a>.
      </p>
    </>
  );
}
