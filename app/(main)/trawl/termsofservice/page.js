import LegalPage from '../LegalPage';
import TermsOfServiceContent, { TERMS_LAST_UPDATED } from '../../legal/TermsOfServiceContent';

export const metadata = {
  title: 'Terms of Service · martinbarker.me',
  description: 'Terms of Service for Trawl, Listogs and RipTag on martinbarker.me.',
};

export default function TermsOfServicePage() {
  return (
    <LegalPage kicker="martinbarker.me · Trawl, Listogs & RipTag" title="Terms of Service" lastUpdated={TERMS_LAST_UPDATED}>
      <TermsOfServiceContent />
    </LegalPage>
  );
}
