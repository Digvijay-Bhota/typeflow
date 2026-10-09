import { LegalPage, legalPageMetadata } from "@/features/legal/components/LegalPage";

export const metadata = legalPageMetadata("/contact");

export default function ContactPage() {
  return <LegalPage href="/contact" />;
}
