/**
 * The legal pages are working drafts until the operator confirms them.
 *
 * While true, every legal page says so above the text — the policies have not
 * been legally reviewed, and the correspondence address (with its PIN code) is
 * unconfirmed — and asks search engines not to index it. The operator has
 * confirmed the support email and that its inbox is monitored (9 October 2026).
 * Set it to false only after the operator has confirmed the full postal
 * address with PIN code and the other pre-publication items, and has removed
 * the drafting notes from the policy text.
 */
export const LEGAL_PAGES_DRAFT = true;

export type LegalPageDefinition = {
  href: string;
  /** Link text (footer, related policies). */
  label: string;
  /** Meta title. */
  title: string;
  description: string;
};

// No policy text here: the shell navigation (client components) imports this
// module. The text is in ./content, mapped by LEGAL_PAGE_SOURCES.

export const LEGAL_PAGES = [
  {
    href: "/terms",
    label: "Terms of Service",
    title: "Terms of Service",
    description:
      "The terms that govern TypeFlow's typing tests, certificates, Pro subscriptions and assessments.",
  },
  {
    href: "/privacy",
    label: "Privacy Policy",
    title: "Privacy Policy",
    description: "How TypeFlow collects, uses, shares and retains personal information.",
  },
  {
    href: "/refund-policy",
    label: "Refund Policy",
    title: "Refund Policy",
    description:
      "When payments for TypeFlow Pro and certificates can be refunded, and how to ask.",
  },
  {
    href: "/cancellation-policy",
    label: "Cancellation Policy",
    title: "Cancellation Policy",
    description: "How to cancel TypeFlow Pro and what happens after you cancel.",
  },
  {
    href: "/contact",
    label: "Contact",
    title: "Contact & Grievance Redressal",
    description: "How to contact TypeFlow for support, complaints and privacy requests.",
  },
] as const satisfies readonly LegalPageDefinition[];

export type LegalPageHref = (typeof LEGAL_PAGES)[number]["href"];

export function getLegalPage(href: LegalPageHref): LegalPageDefinition {
  return LEGAL_PAGES.find((page) => page.href === href)!;
}
