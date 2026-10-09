import LegalPage from '../LegalPage';
import PrivacyPolicyContent, { PRIVACY_LAST_UPDATED } from '../../legal/PrivacyPolicyContent';

export const metadata = {
  title: 'Privacy Policy · martinbarker.me',
  description: 'Privacy Policy for Trawl, Listogs and RipTag on martinbarker.me, including how YouTube API Services data is used.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage kicker="martinbarker.me · Trawl, Listogs & RipTag" title="Privacy Policy" lastUpdated={PRIVACY_LAST_UPDATED}>
      <PrivacyPolicyContent />
    </LegalPage>
  );
}
