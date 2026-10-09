import { LegalPage, legalPageMetadata } from "@/features/legal/components/LegalPage";

export const metadata = legalPageMetadata("/cancellation-policy");

export default function CancellationPolicyPage() {
  return <LegalPage href="/cancellation-policy" />;
}
