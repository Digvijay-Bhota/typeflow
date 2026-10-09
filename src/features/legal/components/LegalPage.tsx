import Link from "next/link";
import type { Metadata } from "next";
import { Fragment } from "react";
import { Container } from "@/components/ui";
import { constructMetadata } from "@/lib/seo";
import {
  LEGAL_PAGES,
  LEGAL_PAGES_DRAFT,
  getLegalPage,
  type LegalPageHref,
} from "../legalPages";
import { LEGAL_PAGE_SOURCES } from "../content";
import {
  parseLegalMarkdown,
  type LegalBlock,
  type LegalInline,
} from "../lib/legalMarkdown";

/** Pages with at least this many sections get a table of contents. */
const TOC_MIN_SECTIONS = 6;

export function legalPageMetadata(href: LegalPageHref): Metadata {
  const page = getLegalPage(href);
  return constructMetadata({
    title: page.title,
    description: page.description,
    path: page.href,
    // A draft must not be indexed as TypeFlow's published policy.
    noindex: LEGAL_PAGES_DRAFT,
  });
}

function Inline({ nodes }: { nodes: LegalInline[] }) {
  return nodes.map((node, i) =>
    node.type === "text" ? (
      <Fragment key={i}>{node.text}</Fragment>
    ) : node.type === "strong" ? (
      <strong key={i} className="text-foreground font-semibold">
        <Inline nodes={node.children} />
      </strong>
    ) : (
      <em key={i}>
        <Inline nodes={node.children} />
      </em>
    )
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "heading":
      if (block.level === 1) {
        return (
          <h1 id={block.id} className="text-title text-foreground font-semibold">
            <Inline nodes={block.children} />
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2
            id={block.id}
            className="text-foreground mt-6 scroll-mt-24 text-xl font-semibold tracking-tight"
          >
            <Inline nodes={block.children} />
          </h2>
        );
      }
      return (
        <h3
          id={block.id}
          className="text-foreground mt-2 scroll-mt-24 text-lg font-semibold"
        >
          <Inline nodes={block.children} />
        </h3>
      );
    case "paragraph":
      return (
        <p>
          {block.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              <Inline nodes={line} />
            </Fragment>
          ))}
        </p>
      );
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List
          className={`flex flex-col gap-2 pl-6 ${block.ordered ? "list-decimal" : "list-disc"}`}
        >
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline nodes={item} />
            </li>
          ))}
        </List>
      );
    }
    case "rule":
      return <hr className="border-border my-4" />;
  }
}

function DraftNotice() {
  return (
    <div
      role="note"
      aria-label="Draft notice"
      className="border-warning/40 bg-warning/10 text-foreground rounded-card border p-4 text-sm"
    >
      <p className="font-semibold">Draft — awaiting confirmation</p>
      <p className="text-secondary mt-1">
        This policy is a working draft and has not been reviewed by a lawyer.
      </p>
    </div>
  );
}

/** A legal policy page: the policy text, its contents, and the related policies. */
export function LegalPage({ href }: { href: LegalPageHref }) {
  const blocks = parseLegalMarkdown(LEGAL_PAGE_SOURCES[href]);
  const sections = blocks.filter(
    (b): b is Extract<LegalBlock, { type: "heading" }> =>
      b.type === "heading" && b.level === 2
  );
  const related = LEGAL_PAGES.filter((p) => p.href !== href);

  return (
    <Container size="narrow" className="flex flex-col gap-8 py-12">
      {LEGAL_PAGES_DRAFT && <DraftNotice />}

      <article className="text-secondary flex flex-col gap-4 leading-relaxed">
        {blocks.map((block, i) => (
          <Fragment key={i}>
            <Block block={block} />
            {i === 1 && sections.length >= TOC_MIN_SECTIONS && (
              <nav
                aria-label="On this page"
                className="border-border bg-surface rounded-card border p-4"
              >
                <h2 className="text-foreground text-sm font-semibold">On this page</h2>
                <ol className="mt-3 flex flex-col gap-1.5 text-sm">
                  {sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="text-secondary hover:text-foreground rounded-sm underline-offset-4 hover:underline"
                      >
                        {section.text}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
          </Fragment>
        ))}
      </article>

      <nav aria-label="Related policies" className="border-border border-t pt-6">
        <h2 className="text-foreground text-sm font-semibold">Related policies</h2>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {related.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className="text-accent rounded-sm underline-offset-4 hover:underline"
              >
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Container>
  );
}
