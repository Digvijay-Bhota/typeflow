import type { LegalPageHref } from "../legalPages";
import { CANCELLATION_POLICY } from "./cancellationPolicy";
import { CONTACT_AND_GRIEVANCE } from "./contactAndGrievance";
import { PRIVACY_POLICY } from "./privacyPolicy";
import { REFUND_POLICY } from "./refundPolicy";
import { TERMS_OF_SERVICE } from "./termsOfService";

/** The policy text of each legal page. */
export const LEGAL_PAGE_SOURCES: Record<LegalPageHref, string> = {
  "/terms": TERMS_OF_SERVICE,
  "/privacy": PRIVACY_POLICY,
  "/refund-policy": REFUND_POLICY,
  "/cancellation-policy": CANCELLATION_POLICY,
  "/contact": CONTACT_AND_GRIEVANCE,
};
