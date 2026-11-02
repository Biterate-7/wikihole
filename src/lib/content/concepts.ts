import { inlineText } from "./parse";
import type { ArticleDocument, Block, Equation, Inline, LinkStat, Term } from "./types";

/**
 * Deterministic, source-grounded extraction of key concepts, terminology and
 * equations from a parsed article. Nothing here is generated: every item
 * points back to text or links that exist in the article.
 */

const NOISE_TITLE =
  /^(\d{1,4}s?( BC| AD| BCE| CE)?|\d{1,2}(st|nd|rd|th) century( BC)?|(January|February|March|April|May|June|July|August|September|October|November|December)( \d{1,2})?|ISBN.*|.* \(identifier\)|Wayback Machine)$/i;

/** Very common link targets that say little about the subject. */
const GENERIC_TITLES = new Set(
  [
    "Mathematics",
    "Computer science",
    "Physics",
    "Science",
    "English language",
    "United States",
    "United Kingdom",
    "Germany",
    "France",
    "Latin",
    "Ancient Greek",
    "Greek language",
    "World War II",
    "World War I",
  ].map((t) => t.toLowerCase()),
);

export function isNoiseTitle(title: string): boolean {
  return NOISE_TITLE.test(title) || GENERIC_TITLES.has(title.toLowerCase());
}

export function rankLinks(links: LinkStat[]): LinkStat[] {
  const weight = (l: LinkStat) => l.count + (l.inLead ? 4 : 0) + 2 / (1 + Math.max(l.firstSection, 0)) - l.order / 2000;
  return links.filter((l) => !isNoiseTitle(l.title)).sort((a, b) => weight(b) - weight(a));
}

export interface KeyConcept {
  title: string;
  mentions: number;
  inLead: boolean;
}

/** The concepts the article leans on most: heavily or prominently linked articles. */
export function keyConcepts(doc: ArticleDocument, limit = 10): KeyConcept[] {
  return rankLinks(doc.links)
    .filter((l) => l.title.toLowerCase() !== doc.title.toLowerCase())
    .slice(0, limit)
    .map((l) => ({ title: l.title, mentions: l.count, inLead: l.inLead }));
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9("'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const DEFINING_PHRASE = /\b(?:called|known as|termed|referred to as|named|dubbed|denoted)\s+(?:the\s+|an?\s+)?["“]?$/i;

/**
 * Terms the article marks as defined: bold text (Wikipedia's convention), and
 * italic text directly after a defining phrase ("is called the ...").
 */
function collectDefined(nodes: Inline[], into: string[], state = { before: "" }): void {
  for (const n of nodes) {
    if (n.k === "strong" || (n.k === "em" && DEFINING_PHRASE.test(state.before.slice(-40)))) {
      const text = inlineText(n.c).replace(/\s+/g, " ").trim();
      if (text && !/^[\d\s.,]+$/.test(text)) into.push(text);
      state.before += text;
    } else if (n.k === "text") {
      state.before += n.v;
    } else if ("c" in n && n.k !== "link") {
      collectDefined(n.c, into, state);
    } else if ("c" in n) {
      state.before += inlineText(n.c);
    }
  }
}

/**
 * Terms the article itself introduces in bold (Wikipedia's convention for
 * defined terms and alternative names) or in definition lists, together with
 * the sentence that introduces them.
 */
export function terminology(doc: ArticleDocument, limit = 12): Term[] {
  const terms: Term[] = [];
  const seen = new Set<string>([doc.title.toLowerCase()]);

  const consider = (term: string, context: string, sectionId?: string) => {
    const key = term.toLowerCase().replace(/[.,:;]$/, "");
    if (term.length < 2 || term.length > 60 || seen.has(key) || /^\d+$/.test(key)) return;
    if (!context || context.length < term.length + 10) return;
    seen.add(key);
    terms.push({ term: term.replace(/[.,:;]$/, ""), context: context.length > 320 ? `${context.slice(0, 317)}…` : context, sectionId });
  };

  const visit = (blocks: Block[], sectionId?: string) => {
    for (const block of blocks) {
      if (block.k === "p") {
        const strong: string[] = [];
        collectDefined(block.c, strong);
        if (strong.length === 0) continue;
        const sents = sentences(inlineText(block.c));
        for (const term of strong) {
          const context = sents.find((s) => s.includes(term));
          if (context) consider(term, context, sectionId);
        }
      } else if (block.k === "dl") {
        for (const item of block.items) {
          if (!item.term || item.defs.length === 0) continue;
          const term = inlineText(item.term).trim();
          const def = sentences(inlineText(item.defs[0]))[0] ?? "";
          if (term && def) consider(term, `${term}: ${def}`, sectionId);
        }
      } else if (block.k === "quote") {
        visit(block.c, sectionId);
      }
    }
  };

  visit(doc.lead);
  for (const section of doc.sections) if (section.kind === "content") visit(section.blocks, section.id);
  return terms.slice(0, limit);
}

/** All display equations, with the section they appear in. */
export function equations(doc: ArticleDocument, limit = 24): Equation[] {
  const out: Equation[] = [];
  const visit = (blocks: Block[], sectionId?: string, sectionTitle?: string) => {
    for (const block of blocks) {
      if (block.k === "math") out.push({ tex: block.tex, html: block.html, sectionId, sectionTitle });
      else if (block.k === "quote") visit(block.c, sectionId, sectionTitle);
      else if (block.k === "list") for (const item of block.items) visit(item.sub, sectionId, sectionTitle);
    }
  };
  visit(doc.lead);
  for (const s of doc.sections) if (s.kind === "content") visit(s.blocks, s.id, s.title);
  return out.slice(0, limit);
}

/** Plain text of the lead and content sections, for grounding checks and AI prompts. */
export function articlePlainText(doc: ArticleDocument, maxChars = 60000): string {
  const parts: string[] = [];
  const visit = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.k === "p" || b.k === "note") parts.push(inlineText(b.c));
      else if (b.k === "h") parts.push(`\n${b.text}\n`);
      else if (b.k === "list") for (const i of b.items) {
        parts.push(`- ${inlineText(i.c)}`);
        visit(i.sub);
      }
      else if (b.k === "dl") for (const i of b.items) {
        parts.push([i.term ? inlineText(i.term) : "", ...i.defs.map(inlineText)].filter(Boolean).join(": "));
      }
      else if (b.k === "math") parts.push(b.tex);
      else if (b.k === "quote") visit(b.c);
      else if (b.k === "figure") parts.push(inlineText(b.caption));
    }
  };
  visit(doc.lead);
  for (const s of doc.sections) {
    if (s.kind !== "content") continue;
    parts.push(`\n## ${s.title}\n`);
    visit(s.blocks);
  }
  const text = parts.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
