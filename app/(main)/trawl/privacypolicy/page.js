import LegalPage from '../LegalPage';

export const metadata = {
  title: 'Privacy Policy · Trawl',
  description: 'Privacy Policy for the Trawl Discord bot.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage kicker="Trawl" title="Privacy Policy" lastUpdated="July 4, 2026">
      <p>
        This Privacy Policy explains what information the <strong>Trawl</strong> Discord bot
        (the &quot;Service&quot;) collects, how it is used, and the choices you have. By using the Service you
        agree to this policy. It applies alongside our{' '}
        <a href="/trawl/termsofservice">Terms of Service</a>.
      </p>

      <h2>1. Information we process</h2>
      <p>To provide the Service, the bot processes:</p>
      <ul>
        <li>
          <strong>Discord message content</strong> from the channels you designate — specifically the music
          links (such as YouTube URLs) shared in those channels, along with limited context such as the message
          author&apos;s Discord ID and the server and channel IDs needed to operate the bot.
        </li>
        <li>
          <strong>YouTube authorization data</strong> — when you connect the YouTube Data API, we use the
          resulting access tokens solely to add tracks to the playlist you specify.
        </li>
        <li>
          <strong>Playlist configuration</strong> — the identifiers of the input channels and the target
          YouTube playlist you set up.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <p>
        We use this information only to operate the core feature of the Service: reading shared links from your
        chosen channels and adding the matching tracks to your YouTube playlist. We do not use your data for
        advertising, and we do not sell it.
      </p>

      <h2>3. What we do not collect</h2>
      <p>
        The bot does not read messages in channels you have not designated, and it does not intentionally
        collect private direct messages, payment information, or sensitive personal data. It only needs the
        Discord permissions required to read the configured channels and respond to its commands.
      </p>

      <h2>4. Data retention</h2>
      <p>
        Links and scan results are retained only as long as needed to build and update your playlist. When you
        remove the bot from your server or revoke its access, it stops processing your server&apos;s messages.
        You may request deletion of any data associated with your server by contacting us (see below).
      </p>

      <h2>5. Data sharing and third parties</h2>
      <p>
        The Service transmits data to the platforms required to function — namely{' '}
        <a href="https://discord.com/privacy" target="_blank" rel="noopener noreferrer">Discord</a>{' '}
        and the YouTube Data API, which is subject to the{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.
        Google&apos;s use of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements. We do not share your information with any other third parties
        except as required by law.
      </p>

      <h2>6. Security</h2>
      <p>
        We take reasonable measures to protect the information the Service processes, including the secure
        handling of authorization tokens. However, no method of transmission or storage is completely secure,
        and we cannot guarantee absolute security.
      </p>

      <h2>7. Your choices</h2>
      <ul>
        <li>Remove the bot from your Discord server at any time to stop all processing.</li>
        <li>Revoke the bot&apos;s YouTube access from your Google Account&apos;s connected-apps settings.</li>
        <li>Contact us to request access to, or deletion of, data associated with your server.</li>
      </ul>

      <h2>8. Children&apos;s privacy</h2>
      <p>
        The Service is not directed to children under the age required to use Discord in their jurisdiction and
        does not knowingly collect personal information from them.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be reflected by the
        &quot;Last updated&quot; date above. Your continued use of the Service after an update constitutes
        acceptance of the revised policy.
      </p>

      <h2>10. Contact</h2>
      <p>
        For privacy questions or data requests, contact{' '}
        <a href="mailto:martinbarker99@gmail.com">martinbarker99@gmail.com</a>.
      </p>
    </LegalPage>
  );
}
