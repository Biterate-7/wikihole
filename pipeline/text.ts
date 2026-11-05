import { findWikipediaUrls, parseWikipediaUrl, type WikipediaReference } from "@/lib/curated/links";

/** Extracts each Wikipedia link in a piece of discussion text, with the words around it. */

export interface LinkContext {
  reference: WikipediaReference;
  /** Words around the link; the link itself reads [[Title]], other links read [link]. */
  context: string;
  /** Short quotation for display, at most EXCERPT_CHARS long. */
  excerpt: string;
  /** Wikipedia articles linked from the same text, including this one. */
  linksInText: number;
  /** Words of commentary in the whole text, links excluded. */
  wordsInText: number;
}

const CONTEXT_CHARS = 320;
const EXCERPT_CHARS = 240;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

const PLACEHOLDER = (i: number) => `\u0001${i}\u0002`;
const PLACEHOLDERS = /\u0001(\d+)\u0002/g;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Finds Wikipedia links in HTML (anchors first, then any bare URLs) and in plain
 * text. Duplicate links to one article within a text count once.
 */
export function extractLinks(html: string): LinkContext[] {
  const urls: string[] = [];
  const withAnchors = html.replace(/<a\b[^>]*?href="([^"]*)"[^>]*>[\s\S]*?<\/a>/gi, (_, href: string) => {
    urls.push(decodeEntities(href));
    return ` ${PLACEHOLDER(urls.length - 1)} `;
  });
  const stripped = decodeEntities(withAnchors.replace(/<\/?(?:p|br|li|div|blockquote|pre)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "));
  const text = stripped.replace(/https?:\/\/[^\s<>"'\]]+/gi, (bare) => {
    if (findWikipediaUrls(bare).length === 0) return "[link]";
    urls.push(bare);
    return ` ${PLACEHOLDER(urls.length - 1)} `;
  });

  const references = urls.map((url) => parseWikipediaUrl(url));
  const seen = new Set<string>();
  const unique: number[] = [];
  references.forEach((reference, i) => {
    if (!reference) return;
    const key = `${reference.lang}:${reference.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(i);
  });
  if (unique.length === 0) return [];

  const wordsInText = clean(text.replace(PLACEHOLDERS, " ")).split(" ").filter(Boolean).length;
  return unique.map((index) => {
    const marker = PLACEHOLDER(index);
    const at = text.indexOf(marker);
    const render = (slice: string) =>
      clean(
        slice.replace(PLACEHOLDERS, (_, i: string) =>
          Number(i) === index ? `[[${references[index]!.title}]]` : references[Number(i)] ? `[[${references[Number(i)]!.title}]]` : "[link]",
        ),
      );
    const before = text.slice(Math.max(0, at - CONTEXT_CHARS), at);
    const after = text.slice(at + marker.length, at + marker.length + CONTEXT_CHARS);
    const context = render(`${before}${marker}${after}`);
    return {
      reference: references[index]!,
      context,
      excerpt: excerptAround(render(before), render(after), references[index]!.title),
      linksInText: unique.length,
      wordsInText,
    };
  });
}

/** The sentence holding the link, trimmed to a short quotation. */
function excerptAround(before: string, after: string, title: string): string {
  const sentenceStart = Math.max(before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "));
  const lead = sentenceStart >= 0 ? before.slice(sentenceStart + 2) : before;
  const end = after.search(/[.?!](\s|$)/);
  const tail = end >= 0 ? after.slice(0, end + 1) : after;
  let excerpt = clean(`${lead} [[${title}]] ${tail}`);
  if (excerpt.length > EXCERPT_CHARS) {
    const link = excerpt.indexOf("[[");
    const start = Math.max(0, link - Math.floor(EXCERPT_CHARS * 0.6));
    excerpt = `${start > 0 ? "…" : ""}${excerpt.slice(start, start + EXCERPT_CHARS).trim()}…`;
  }
  return excerpt;
}
