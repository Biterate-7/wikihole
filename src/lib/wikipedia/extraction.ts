import { isNoiseTitle } from "@/lib/content/concepts";
import type { ArticleDocument, Block, Inline } from "@/lib/content/types";

/**
 * Structural link evidence from a parsed Wikipedia article: where each linked
 * article appears (the defining sentence, the introduction, an infobox row,
 * a History or Legacy section, See also). The relationship engine turns
 * these positions into typed, explained relations, so every relation can be
 * traced back to a specific place in the source article.
 */

export type EvidenceKind =
  | "definition"
  | "lead"
  | "infobox"
  | "history-section"
  | "legacy-section"
  | "usage-section"
  | "section"
  | "see-also";

export interface LinkEvidence {
  title: string;
  kind: EvidenceKind;
  /** Section heading or infobox label backing the evidence. */
  detail?: string;
  /** Order of first appearance within its kind (0 = first). */
  position: number;
}

const HISTORY_HEADING = /\b(history|historical|background|origins?|development|precursors?|early|etymology|invention|discovery|chronology|timeline|beginnings|design and development)\b/i;
const LEGACY_HEADING = /\b(legacy|influence|impact|successors?|descendants?|derivatives?|dialects|variants|forks|aftermath|later developments)\b/i;
const USAGE_HEADING = /\b(applications?|adoption|usage|uses|use in|users|implementations|deployment|reception|in practice)\b/i;

/** Link targets that come from pronunciation, language or citation markup rather than the subject. */
const MARKUP_TITLE = /^(?:(?:American|British|Australian|Canadian) English|Help:.*|International Phonetic Alphabet|IPA|Pronunciation.*|Digital object identifier|ISSN|PMID|Bibcode|S2CID)$/i;

/** Infobox labels whose links point to ancestors, creators or influences. */
export const INFOBOX_HISTORICAL = /^(influenced by|designed by|designer|developer|developed by|developers|inventor|invented by|created by|creator|original author\(s\)|author|founder|founders|founded by|manufacturer|predecessor|discovered by|named after|based on|first appeared|introduced)$/i;
/** Infobox labels whose links point to descendants. */
export const INFOBOX_DESCENDANT = /^(influenced|successor|derivatives|dialects|forks|major implementations|implementations)$/i;
/** Infobox labels describing what kind of thing the subject is (paradigms, families, fields). */
export const INFOBOX_FOUNDATION = /^(paradigms?|family|typing discipline|type|class|field|fields|branch|genre|category|written in|implementation language|engine|based on|purpose|uses)$/i;
/** Infobox rows whose links say nothing about the subject's ideas (licences, platforms, release metadata). */
const INFOBOX_IGNORED = /^(licen[cs]e|website|filename extensions?|stable release|preview release|operating system|os|platform|available in|size|repository|standard|official website|internet media type|type code|magic number|location|country|headquarters|area served|key people|products|revenue|owner|parent|employees|number of employees|native name|coordinates)$/i;

function linksIn(nodes: Inline[], into: string[]): void {
  for (const node of nodes) {
    if (node.k === "link") into.push(node.to);
    if ("c" in node && node.k !== "link") linksIn(node.c, into);
  }
}

function blockLinks(blocks: Block[], into: string[]): void {
  for (const block of blocks) {
    if (block.k === "p" || block.k === "note") linksIn(block.c, into);
    else if (block.k === "list") for (const item of block.items) {
      linksIn(item.c, into);
      blockLinks(item.sub, into);
    }
    else if (block.k === "dl") for (const item of block.items) {
      if (item.term) linksIn(item.term, into);
      for (const def of item.defs) linksIn(def, into);
    }
    else if (block.k === "quote") blockLinks(block.c, into);
  }
}

/** Links that appear in the first sentence of the introduction ("X is a Y that…"). */
export function definitionLinks(doc: ArticleDocument): string[] {
  const first = doc.lead.find((b): b is Extract<Block, { k: "p" }> => b.k === "p" && b.c.length > 0);
  if (!first) return [];
  const out: string[] = [];
  let text = "";
  const walk = (nodes: Inline[]): boolean => {
    for (const node of nodes) {
      if (node.k === "text") {
        text += node.v;
        // Sentence end: a full stop followed by a space and a capital, or the paragraph's end.
        if (/[.!?]\s+[A-Z(]/.test(text) || /\.\s*$/.test(node.v) && text.length > 40) return true;
      } else if (node.k === "link") {
        out.push(node.to);
        walk(node.c);
      } else if (node.k === "math") {
        text += node.tex;
      } else if ("c" in node) {
        if (walk(node.c)) return true;
      }
    }
    return false;
  };
  walk(first.c);
  return out;
}

export function linkEvidence(doc: ArticleDocument): LinkEvidence[] {
  const evidence: LinkEvidence[] = [];
  const seen = new Set<string>();
  const self = doc.title.toLowerCase();
  const positions = new Map<EvidenceKind, number>();
  const add = (title: string, kind: EvidenceKind, detail?: string) => {
    if (title.toLowerCase() === self || isNoiseTitle(title) || MARKUP_TITLE.test(title)) return;
    const key = `${kind}|${title}`;
    if (seen.has(key)) return;
    seen.add(key);
    const position = positions.get(kind) ?? 0;
    positions.set(kind, position + 1);
    evidence.push({ title, kind, ...(detail ? { detail } : {}), position });
  };

  for (const title of definitionLinks(doc)) add(title, "definition");
  const lead: string[] = [];
  blockLinks(doc.lead, lead);
  for (const title of lead) add(title, "lead");

  for (const row of doc.infobox) {
    if (INFOBOX_IGNORED.test(row.label)) continue;
    const links: string[] = [];
    linksIn(row.value, links);
    for (const title of links) add(title, "infobox", row.label);
  }

  for (const section of doc.sections) {
    if (section.kind === "see-also") continue;
    if (section.kind !== "content") continue;
    let heading = section.title;
    let pending: Block[] = [];
    const flush = () => {
      const links: string[] = [];
      blockLinks(pending, links);
      const kind: EvidenceKind = HISTORY_HEADING.test(heading) || HISTORY_HEADING.test(section.title)
        ? "history-section"
        : LEGACY_HEADING.test(heading) || LEGACY_HEADING.test(section.title)
          ? "legacy-section"
          : USAGE_HEADING.test(heading) || USAGE_HEADING.test(section.title)
            ? "usage-section"
            : "section";
      for (const title of links) add(title, kind, heading);
      pending = [];
    };
    for (const block of section.blocks) {
      if (block.k === "h") {
        flush();
        heading = block.text;
      } else pending.push(block);
    }
    flush();
  }

  for (const title of doc.seeAlso) add(title, "see-also");
  return evidence;
}
