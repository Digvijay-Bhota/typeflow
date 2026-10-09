import { LegalPage, legalPageMetadata } from "@/features/legal/components/LegalPage";

export const metadata = legalPageMetadata("/refund-policy");

export default function RefundPolicyPage() {
  return <LegalPage href="/refund-policy" />;
}
