import LegalPage from '../LegalPage';

export const metadata = {
  title: 'Terms of Service · Trawl',
  description: 'Terms of Service for the Trawl Discord bot.',
};

export default function TermsOfServicePage() {
  return (
    <LegalPage kicker="Trawl" title="Terms of Service" lastUpdated="July 4, 2026">
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your use of the <strong>Trawl</strong>{' '}
        Discord bot and related pages hosted at <a href="https://martinbarker.me/trawl">martinbarker.me/trawl</a>{' '}
        (collectively, the &quot;Service&quot;). By adding the bot to a Discord server or using any of its
        commands, you agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <h2>1. What the Service does</h2>
      <p>
        Trawl scans messages in the Discord channels you designate for music links (for example
        YouTube URLs), collects those links, and adds the corresponding tracks to a YouTube playlist that you
        connect. The Service is provided as a free, open-source tool.
      </p>

      <h2>2. Eligibility and Discord&apos;s terms</h2>
      <p>
        You must be old enough to use Discord in your jurisdiction and comply with the{' '}
        <a href="https://discord.com/terms" target="_blank" rel="noopener noreferrer">Discord Terms of Service</a>{' '}
        and <a href="https://discord.com/guidelines" target="_blank" rel="noopener noreferrer">Community Guidelines</a>.
        To add the bot to a server, you must have the appropriate permissions (such as <code>Manage Server</code>)
        on that server.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>violate any law or the terms of any third-party service, including Discord and YouTube;</li>
        <li>infringe the intellectual property rights of others;</li>
        <li>collect, store, or share content in a way that harms other users; or</li>
        <li>abuse, overload, disrupt, or attempt to gain unauthorized access to the Service or its infrastructure.</li>
      </ul>

      <h2>4. Third-party services</h2>
      <p>
        The Service interacts with Discord and with the YouTube Data API. Your use of those platforms is
        governed by their own terms, including the{' '}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a>{' '}
        and the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>.
        Trawl is not affiliated with, endorsed by, or sponsored by Discord, YouTube, or Google.
      </p>

      <h2>5. Your content and accounts</h2>
      <p>
        You are responsible for the servers you add the bot to, the channels you point it at, and the YouTube
        account or playlist you connect. You represent that you have the right to add the bot and to modify the
        connected playlist. You can remove the bot from a server at any time to stop the Service.
      </p>

      <h2>6. Availability and changes</h2>
      <p>
        The Service is offered on an &quot;as is&quot; and &quot;as available&quot; basis. We may modify,
        suspend, or discontinue any part of the Service at any time without notice. We may also update these
        Terms; material changes will be reflected by the &quot;Last updated&quot; date above, and your continued
        use of the Service constitutes acceptance of the revised Terms.
      </p>

      <h2>7. Disclaimer of warranties</h2>
      <p>
        To the maximum extent permitted by law, the Service is provided without warranties of any kind, whether
        express or implied, including fitness for a particular purpose and non-infringement. We do not warrant
        that the Service will be uninterrupted, error-free, or that any playlist will be complete or accurate.
      </p>

      <h2>8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, in no event will the operator of Trawl be liable for
        any indirect, incidental, special, consequential, or punitive damages, or any loss of data, arising out
        of or related to your use of the Service.
      </p>

      <h2>9. Contact</h2>
      <p>
        Questions about these Terms can be sent to{' '}
        <a href="mailto:martinbarker99@gmail.com">martinbarker99@gmail.com</a>. See also our{' '}
        <a href="/trawl/privacypolicy">Privacy Policy</a>.
      </p>
    </LegalPage>
  );
}
