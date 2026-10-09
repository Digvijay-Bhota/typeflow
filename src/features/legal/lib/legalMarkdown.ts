/**
 * A deliberately small Markdown subset for the legal pages, so the policy text
 * stays in the operator's own words and format (src/features/legal/content).
 *
 * Supported: `#`/`##`/`###` headings, paragraphs (a line break inside a
 * paragraph is kept), `- ` and `1. ` lists, `**bold**`, `*italic*` and `---`.
 * Everything else is plain text: no HTML, no links, nothing executable.
 */

export type LegalInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: LegalInline[] }
  | { type: "em"; children: LegalInline[] };

export type LegalBlock =
  | {
      type: "heading";
      level: 1 | 2 | 3;
      id: string;
      text: string;
      children: LegalInline[];
    }
  | { type: "paragraph"; lines: LegalInline[][] }
  | { type: "list"; ordered: boolean; items: LegalInline[][] }
  | { type: "rule" };

const HEADING = /^(#{1,3}) (.+)$/;
const BULLET = /^- (.+)$/;
const NUMBERED = /^\d+\. (.+)$/;
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*/g;

export function parseLegalInline(text: string): LegalInline[] {
  const out: LegalInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last)
      out.push({ type: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) {
      out.push({ type: "strong", children: parseLegalInline(match[1]) });
    } else {
      out.push({ type: "em", children: parseLegalInline(match[2] ?? "") });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Plain text of inline content (for heading ids and the table of contents). */
export function legalInlineText(nodes: LegalInline[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.text : legalInlineText(n.children)))
    .join("");
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

export function parseLegalMarkdown(source: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  const usedIds = new Map<string, number>();
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraph.map(parseLegalInline) });
      paragraph = [];
    }
    if (list) {
      blocks.push({
        type: "list",
        ordered: list.ordered,
        items: list.items.map(parseLegalInline),
      });
      list = null;
    }
  };

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flush();
      continue;
    }
    if (line === "---") {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const children = parseLegalInline(heading[2]!);
      const text = legalInlineText(children);
      const base = slugify(text);
      const seen = usedIds.get(base) ?? 0;
      usedIds.set(base, seen + 1);
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        id: seen === 0 ? base : `${base}-${seen + 1}`,
        text,
        children,
      });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (paragraph.length > 0 || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    if (list) flush();
    paragraph.push(line);
  }
  flush();
  return blocks;
}
