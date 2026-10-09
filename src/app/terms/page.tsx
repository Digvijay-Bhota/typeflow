import { LegalPage, legalPageMetadata } from "@/features/legal/components/LegalPage";

export const metadata = legalPageMetadata("/terms");

export default function TermsPage() {
  return <LegalPage href="/terms" />;
}
