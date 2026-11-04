import { classifyGroup, isBiography } from "@/lib/discovery/score";
import type { PageMeta } from "@/lib/wikipedia/types";
import { isNoiseTitle, rankLinks, terminology } from "./concepts";
import type { ArticleDocument } from "./types";

/**
 * Chooses the terms the reader offers to explain: specialised vocabulary worth
 * a reader's pause, not every link. Candidates come only from the article's
 * own links and bold-faced definitions, and are judged on Wikipedia's metadata
 * about the linked page. Nothing here is generated.
 */

export interface ReaderTerm {
  /** Text to look for: the linked article's title, or the phrase the article defines in bold. */
  match: string;
  kind: "link" | "defined";
  /** Article to read for this term, when Wikipedia has one. */
  link?: string;
  description?: string;
  extract?: string;
}

/** Linked pages looked up per article, most prominent first. */
export const TERM_CANDIDATES = 60;

const MAX_TERMS = 24;
const MIN_TERMS = 5;
const WORDS_PER_TERM = 250;
const MAX_DEFINED_TERMS = 6;
const EXTRACT_CHARS = 280;

/** Pages this widely read (over 14 days) are household names, whatever their subject. */
const FAMILIAR_VIEWS = 150_000;

/** Short descriptions of things a reader knows by name rather than as terminology. */
const NOT_TERMINOLOGY =
  /\b(?:country|nation|city|capital|town|village|state|province|county|region|continent|river|mountain|island|borough|district|municipality|commune|neighbou?rhood|language|ethnic group|surname|given name|year|decade|century|film|novel|album|song|band|television|newspaper|magazine|company|corporation|university|college|school|museum|sports?|football|disambiguation|topics referred to)\b/i;

/** "German mathematician (1912–1954)": people are read about, not defined. */
const DESCRIBES_PERSON = /\(\s*(?:born\s+|b\.\s*|died\s+|d\.\s*|c\.\s*)?\d{3,4}\s*[–-]?\s*\d{0,4}\s*\)|\b(?:born|died) \d{3,4}\b/i;

/** Short descriptions that mark a page as a concept, field, device or period of study. */
const TERMINOLOGY =
  /\b(?:theory|theorem|concept|principle|law|method|technique|process|phenomenon|effect|model|algorithm|protocol|function|equation|mathematical|scientific|technical|technology|device|machine|mechanism|instrument|compound|element|molecule|protein|enzyme|cell|organ|disease|disorder|syndrome|species|genus|structure|system|property|unit|branch of|field of|study of|type of|class of|form of|doctrine|ideology|movement|treaty|dynasty|empire|revolution|period|era|cipher|code|encryption|cryptograph\w*)\b/i;

/** Higher scores are more clearly specialised vocabulary; null means leave it unmarked. */
export function termScore(meta: PageMeta, english: boolean): number | null {
  if (meta.disambiguation || isBiography(meta) || /^(?:list|index|outline|timeline) of /i.test(meta.title)) return null;
  if (meta.recentViews !== null && meta.recentViews > FAMILIAR_VIEWS) return null;
  const description = meta.description ?? "";
  if (english && (NOT_TERMINOLOGY.test(description) || DESCRIBES_PERSON.test(description))) return null;

  let score = 0;
  // Descriptions are English-only signals; the subject classifier reads the page's categories and extract too.
  if (english && TERMINOLOGY.test(description)) score += 2;
  if (classifyGroup(meta)) score += 2;
  if (meta.recentViews !== null && meta.recentViews < FAMILIAR_VIEWS / 10) score += 1;
  return score > 0 ? score : null;
}

function shortExtract(extract: string | undefined): string | undefined {
  if (!extract) return undefined;
  const text = extract.replace(/\s+/g, " ").trim();
  if (text.length <= EXTRACT_CHARS) return text;
  const cut = text.slice(0, EXTRACT_CHARS);
  const sentence = cut.lastIndexOf(". ");
  return sentence > 80 ? cut.slice(0, sentence + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

export function selectTerms(doc: ArticleDocument, metas: Map<string, PageMeta | null>): ReaderTerm[] {
  const english = !doc.lang || doc.lang === "en";
  const limit = Math.min(MAX_TERMS, Math.max(MIN_TERMS, Math.round(doc.stats.words / WORDS_PER_TERM)));
  const docTitle = doc.title.toLowerCase();

  const linked = rankLinks(doc.links)
    .slice(0, TERM_CANDIDATES)
    .flatMap((link, order) => {
      const meta = metas.get(link.title);
      if (!meta || link.title.toLowerCase() === docTitle || meta.title.toLowerCase() === docTitle) return [];
      const score = termScore(meta, english);
      return score === null ? [] : [{ link, meta, score: score * 100 - order }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(
      ({ link, meta }): ReaderTerm => ({
        match: link.title,
        kind: "link",
        link: meta.title,
        description: meta.description,
        extract: shortExtract(meta.extract),
      }),
    );

  const taken = new Set(linked.map((t) => t.match.toLowerCase()));
  const defined = terminology(doc, MAX_DEFINED_TERMS * 2)
    .filter((t) => !taken.has(t.term.toLowerCase()) && !isNoiseTitle(t.term))
    .slice(0, MAX_DEFINED_TERMS)
    .map((t): ReaderTerm => ({ match: t.term, kind: "defined" }));

  return [...linked, ...defined];
}
