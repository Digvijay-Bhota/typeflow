// @vitest-environment happy-dom
/**
 * Legal pages (/terms, /privacy, /refund-policy, /cancellation-policy,
 * /contact): the operator's policy drafts rendered verbatim, flagged as
 * unconfirmed drafts until LEGAL_PAGES_DRAFT is switched off, and linked from
 * the footer. Route existence of the footer links is checked in shell.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));

import { LegalPage, legalPageMetadata } from "@/features/legal/components/LegalPage";
import { LEGAL_PAGE_SOURCES } from "@/features/legal/content";
import { LEGAL_PAGES, LEGAL_PAGES_DRAFT } from "@/features/legal/legalPages";
import { parseLegalMarkdown } from "@/features/legal/lib/legalMarkdown";
import { FOOTER_NAV } from "@/components/shell/navigation";
import { VERIFICATION_MESSAGES, verificationState } from "@/lib/certificateStatus";

afterEach(cleanup);

const ALL_TEXT = Object.values(LEGAL_PAGE_SOURCES).join("\n");
const SUPPORT_EMAIL = "xvshady585@gmail.com";

describe("parseLegalMarkdown", () => {
  it("parses headings with unique ids, lists, line breaks, emphasis and rules", () => {
    const blocks = parseLegalMarkdown(
      [
        "# Title",
        "",
        "**Contact:** a@b.c",
        "**Address:** Somewhere *(confirm)*",
        "",
        "## 1. Scope",
        "",
        "- one",
        "- **two**",
        "",
        "1. first",
        "2. second",
        "",
        "## 1. Scope",
        "",
        "---",
      ].join("\n")
    );

    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "list",
      "list",
      "heading",
      "rule",
    ]);
    expect(blocks[0]).toMatchObject({ level: 1, id: "title", text: "Title" });
    expect(blocks[2]).toMatchObject({ level: 2, id: "1-scope" });
    expect(blocks[5]).toMatchObject({ id: "1-scope-2" });
    expect(blocks[1]).toEqual({
      type: "paragraph",
      lines: [
        [
          { type: "strong", children: [{ type: "text", text: "Contact:" }] },
          { type: "text", text: " a@b.c" },
        ],
        [
          { type: "strong", children: [{ type: "text", text: "Address:" }] },
          { type: "text", text: " Somewhere " },
          { type: "em", children: [{ type: "text", text: "(confirm)" }] },
        ],
      ],
    });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[4]).toMatchObject({ type: "list", ordered: true });
  });

  it("treats HTML and link syntax as plain text", () => {
    const text = '<img src=x onerror="x()"> [a](javascript:x)';
    expect(parseLegalMarkdown(text)).toEqual([
      { type: "paragraph", lines: [[{ type: "text", text }]] },
    ]);
  });
});

describe.each(LEGAL_PAGES.map((p) => [p.href, p] as const))("%s", (href, page) => {
  it("renders one h1, the policy text and links to every other legal page", () => {
    render(h(LegalPage, { href }));

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/^Last updated: 9 October 2026$/)).toBeTruthy();

    const related = screen.getByRole("navigation", { name: "Related policies" });
    const links = within(related)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(links.sort()).toEqual(
      LEGAL_PAGES.filter((p) => p.href !== href)
        .map((p) => p.href)
        .sort()
    );
    expect(page.title.length).toBeGreaterThan(0);
  });

  it("is flagged as an unconfirmed draft and not indexed while LEGAL_PAGES_DRAFT is on", () => {
    expect(LEGAL_PAGES_DRAFT).toBe(true);
    render(h(LegalPage, { href }));

    const notice = screen.getByRole("note", { name: "Draft notice" });
    expect(notice.textContent).toMatch(/has not been reviewed by a lawyer/);
    expect(notice.textContent).toMatch(
      /PIN code for the correspondence address shown here has not yet been confirmed/
    );
    // The operator confirmed they are comfortable publishing the address itself.
    expect(notice.textContent).not.toMatch(
      /The\s+correspondence address|including its PIN code/
    );
    // The operator confirmed the support email and that its inbox is monitored.
    expect(notice.textContent).not.toMatch(/email/i);

    const robots = legalPageMetadata(href).robots as { index: boolean; follow: boolean };
    expect(robots.index).toBe(false);
    expect(robots.follow).toBe(false);
  });

  it("keeps the source page file in the App Router", () => {
    const file = join(process.cwd(), "src/app", href.slice(1), "page.tsx");
    expect(readFileSync(file, "utf8")).toContain(`href="${href}"`);
  });
});

describe("policy content", () => {
  it("long policies get a table of contents whose links point at their sections", () => {
    for (const href of ["/terms", "/privacy"] as const) {
      const { container } = render(h(LegalPage, { href }));
      const toc = screen.getByRole("navigation", { name: "On this page" });
      const targets = within(toc)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")!.slice(1));
      expect(targets.length).toBeGreaterThanOrEqual(6);
      for (const id of targets)
        expect(container.querySelector(`h2#${id}`)).not.toBeNull();
      cleanup();
    }
  });

  it("names the support email and keeps its confirmation notes", () => {
    for (const source of Object.values(LEGAL_PAGE_SOURCES)) {
      expect(source).toContain(SUPPORT_EMAIL);
    }
    expect(LEGAL_PAGE_SOURCES["/contact"]).toContain("Important pre-publication items");
    expect(LEGAL_PAGE_SOURCES["/terms"]).toContain(
      "confirm the full postal address and PIN code before public launch"
    );
  });

  it("records the support email as confirmed, with no note left asking to verify it", () => {
    // The operator confirmed the address and that its inbox is monitored.
    expect(ALL_TEXT).not.toMatch(
      /verify (this|the) email|verif(y|ies) that \*\*xvshady|email’s spelling and monitoring|correctly spelled and monitored before/i
    );
    for (const href of ["/terms", "/privacy", "/cancellation-policy"] as const) {
      expect(LEGAL_PAGE_SOURCES[href], href).toContain(
        "The operator has confirmed that this email address is correct and that its inbox is monitored"
      );
    }
    expect(LEGAL_PAGE_SOURCES["/contact"]).toContain(
      `The operator has confirmed that **${SUPPORT_EMAIL}** is spelled correctly, accessible and monitored`
    );
  });

  it("keeps every other outstanding pre-publication warning", () => {
    const contact = LEGAL_PAGE_SOURCES["/contact"];
    expect(contact).toContain("This page is not publication-ready until the operator:");
    for (const item of [
      "1. confirms the PIN code and any other missing postal details for the correspondence address (the operator has confirmed they are comfortable publishing the address itself",
      "2. chooses and adds a real customer-support phone number if required",
      "3. confirms the production site URL",
      "4. reviews whether any additional consumer grievance or regulatory contact requirements apply to TypeFlow's business structure",
    ]) {
      expect(contact).toContain(item);
    }
    expect(contact).toContain(
      "full postal address/PIN code to be confirmed before publication"
    );
    expect(LEGAL_PAGE_SOURCES["/privacy"]).toContain(
      "Confirm the full postal address and PIN code before publication."
    );
    expect(LEGAL_PAGE_SOURCES["/privacy"]).toContain(
      "**Implementation note:** This is a privacy-policy draft, not a substitute for a data inventory or legal review."
    );
    expect(LEGAL_PAGE_SOURCES["/terms"]).toContain(
      "**Important:** This is a business-specific draft, not legal advice."
    );
  });

  it("shows the corrected support email on every page, and never the earlier misspelling", () => {
    // The pack had xvshad585@gmail.com; the operator corrected it to SUPPORT_EMAIL.
    const misspelled = /xvshad585/;
    expect(ALL_TEXT).not.toMatch(misspelled);
    for (const { href } of LEGAL_PAGES) {
      const { container } = render(h(LegalPage, { href }));
      expect(container.textContent, href).toContain(SUPPORT_EMAIL);
      expect(container.textContent, href).not.toMatch(misspelled);
      cleanup();
    }
  });

  it("preserves rights that cannot lawfully be excluded", () => {
    expect(LEGAL_PAGE_SOURCES["/terms"]).toContain(
      "Nothing in these Terms requires a consumer to give up a statutory right or remedy."
    );
    expect(LEGAL_PAGE_SOURCES["/terms"]).toContain(
      "Nothing in these Terms removes consumer rights that cannot lawfully be excluded."
    );
    expect(LEGAL_PAGE_SOURCES["/refund-policy"]).toContain(
      "Nothing in this Policy limits a right to a refund, cancellation, chargeback, or other remedy that cannot lawfully be excluded."
    );
  });

  it("describes results as server-verified and unproctored", () => {
    expect(LEGAL_PAGE_SOURCES["/terms"]).toContain(
      "**server-verified, unproctored results**"
    );
    expect(ALL_TEXT).not.toMatch(/cheat-proof|tamper-proof/i);
  });

  it("invents no company, registration, phone number or PIN code", () => {
    expect(ALL_TEXT).not.toMatch(/Pvt\.?|Private Limited|\bLLP\b|GSTIN|Udyam|CIN:/);
    expect(ALL_TEXT).not.toMatch(/\b\d{6}\b/); // Indian PIN code
    expect(ALL_TEXT).not.toMatch(/(\+91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/); // mobile number
    expect(ALL_TEXT).not.toMatch(/\b(1800|1860)[\s-]?\d{3}[\s-]?\d{4}\b/); // toll-free
  });

  // The disclosures below describe product behaviour; each test also checks
  // the code it describes, so a product change that falsifies the text fails here.
  const repoFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  it("discloses the public leaderboard and its Settings opt-out", () => {
    const privacy = LEGAL_PAGE_SOURCES["/privacy"];
    expect(privacy).toContain("### Public leaderboards and shared result pages");
    expect(privacy).toContain("**By default, your results can appear on them.**");
    expect(privacy).toMatch(/your best verified result, .*display name/);
    expect(privacy).toContain("includes your avatar (profile picture)");
    expect(privacy).toContain(
      "- anyone viewing the public leaderboards, for your leaderboard entries unless you opt out"
    );

    // Opt-out is off by default, filtered out by the leaderboard query, and the
    // policy names the Settings control by its label.
    expect(repoFile("prisma/schema.prisma")).toMatch(
      /leaderboardOptOut\s+Boolean\s+@default\(false\)/
    );
    const leaderboard = repoFile("src/server/services/leaderboard.service.ts");
    expect(leaderboard).toContain(`u."leaderboardOptOut" = false`);
    expect(leaderboard).toContain(`avatarUrl: r.avatarUrl`);
    expect(leaderboard).toContain(`ts."trustTier" IN ('FREE', 'CERTIFICATE')`);
    const label = "Hide my results from public leaderboards";
    expect(repoFile("src/app/dashboard/settings/page.tsx")).toContain(label);
    expect(privacy).toContain(`**${label}**`);
  });

  it("discloses that result pages are open to anyone with the link and linked from the leaderboard", () => {
    const privacy = LEGAL_PAGE_SOURCES["/privacy"];
    expect(privacy).toContain(
      "**Anyone who has the link can open the result page without signing in.**"
    );
    expect(privacy).toContain("Each leaderboard entry links to its result page");
    expect(privacy).toContain("it does not disable result pages");
    expect(privacy).toContain(
      "- anyone who has the link to one of your result pages, for the details available through that link"
    );

    expect(repoFile("src/app/leaderboard/LeaderboardClient.tsx")).toContain(
      "href={`/result/${entry.shareId}`}"
    );
    // The share page is not behind the dashboard auth gate.
    expect(repoFile("src/middleware.ts")).not.toMatch(/["'`]\/result/);
  });

  it("discloses that a full certificate refund revokes the certificate", () => {
    const refund = LEGAL_PAGE_SOURCES["/refund-policy"];
    expect(refund).toContain("**A full refund invalidates the certificate.**");
    expect(refund).toContain("it will no longer pass verification");
    expect(refund).toContain("A partial refund does not revoke the certificate.");

    const payment = repoFile("src/server/services/payment.service.ts");
    expect(payment).toMatch(/applyFullRefundTx[\s\S]*?revokeCertificateTx\(/);
    expect(payment).toContain(
      "Partial certificate refund processed; certificate left unchanged"
    );
    // Revoked fails verification even when its stored verification data is valid.
    expect(verificationState({ status: "REVOKED" }, true)).toBe("REVOKED");
    expect(VERIFICATION_MESSAGES.REVOKED).toMatch(/revoked and is no longer valid/);
  });

  it("does not claim legal review or guaranteed compliance", () => {
    expect(ALL_TEXT).not.toMatch(
      /legally reviewed|reviewed by (a|our) lawyer|fully compliant|guarantee[sd]? (of )?compliance|ISO 27001|SOC 2|PCI[- ]DSS (certified|compliant)/i
    );
  });
});

describe("footer", () => {
  it("links every legal page from a Legal group", () => {
    const legal = FOOTER_NAV.find((group) => group.title === "Legal");
    expect(legal?.items).toEqual(LEGAL_PAGES.map(({ href, label }) => ({ href, label })));
  });

  it("the module the client navigation imports carries no policy text", () => {
    const source = readFileSync(
      join(process.cwd(), "src/features/legal/legalPages.ts"),
      "utf8"
    );
    expect(source).not.toMatch(/from "\.\/content/);
  });
});
