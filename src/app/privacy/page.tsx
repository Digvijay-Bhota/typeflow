import { LegalPage, legalPageMetadata } from "@/features/legal/components/LegalPage";

export const metadata = legalPageMetadata("/privacy");

export default function PrivacyPage() {
  return <LegalPage href="/privacy" />;
}
