import { inlineText } from "@/lib/content/parse";
import type { ArticleDocument, Block, Inline } from "@/lib/content/types";
import { titleKey } from "./key";

/**
 * Finds the sentence in which an article links to another one: Wikipedia's
 * own words for how the two are related. Only running text counts (the lead
 * and content sections, including lists and quotations), not infoboxes,
 * navigation boxes or See also lists, which link without saying why.
 */

const MAX_QUOTE = 360;

/** Anchor text of the first link to `target` in these inline nodes, if any. */
function anchorTo(nodes: Inline[], targets: Set<string>): string | null {
  for (const node of nodes) {
    if (node.k === "link" && targets.has(titleKey(node.to))) return inlineText(node.c).trim() || node.to;
    if ("c" in node && Array.isArray(node.c)) {
      const inner = anchorTo(node.c as Inline[], targets);
      if (inner) return inner;
    }
  }
  return null;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9("'“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clip(sentence: string): string {
  return sentence.length > MAX_QUOTE ? `${sentence.slice(0, MAX_QUOTE - 1).trimEnd()}…` : sentence;
}

function inParagraph(nodes: Inline[], target: Set<string>): string | null {
  const anchor = anchorTo(nodes, target);
  if (!anchor) return null;
  const all = sentences(inlineText(nodes));
  const sentence = all.find((s) => s.includes(anchor)) ?? null;
  return sentence ? clip(sentence) : null;
}

function inBlocks(blocks: Block[], target: Set<string>): string | null {
  for (const block of blocks) {
    let found: string | null = null;
    if (block.k === "p") found = inParagraph(block.c, target);
    else if (block.k === "list") {
      for (const item of block.items) {
        found = inParagraph(item.c, target) ?? inBlocks(item.sub, target);
        if (found) break;
      }
    } else if (block.k === "quote") found = inBlocks(block.c, target);
    else if (block.k === "dl") {
      for (const item of block.items) {
        for (const def of item.defs) {
          found = inParagraph(def, target);
          if (found) break;
        }
        if (found) break;
      }
    }
    if (found) return found;
  }
  return null;
}

/**
 * The first sentence of running text in `doc` that links to `target`, or null.
 * Pass several spellings when the target may be linked through a redirect.
 */
export function linkingSentence(doc: ArticleDocument, target: string | string[]): string | null {
  const key = new Set((Array.isArray(target) ? target : [target]).map(titleKey));
  const lead = inBlocks(doc.lead, key);
  if (lead) return lead;
  for (const section of doc.sections) {
    if (section.kind !== "content") continue;
    const found = inBlocks(section.blocks, key);
    if (found) return found;
  }
  return null;
}
