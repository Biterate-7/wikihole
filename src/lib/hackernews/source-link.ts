import { isSupportedLanguage } from "@/lib/i18n/languages";
import { articlePath, titleFromWikiHref } from "@/lib/wikipedia/titles";
import type { Submission } from "./types";

export interface SourceLink {
  href: string;
  label: string;
  external: boolean;
}

const WIKIPEDIA_HOST = /^(?:([a-z-]+)\.)?(?:m\.)?wikipedia\.org$/;

/**
 * Where a submission's "original article" link goes. Readers do not leave
 * WikiHole for Wikipedia, and Hacker News submissions often link straight to
 * it: those open in the reader, or show no link if the reader cannot open the
 * page. Everything else goes to the original site.
 */
export function sourceLink(submission: Pick<Submission, "url" | "domain">): SourceLink | null {
  if (!submission.url) return null;
  const wikipedia = submission.domain ? WIKIPEDIA_HOST.exec(submission.domain) : null;
  if (!wikipedia) return { href: submission.url, label: submission.domain ?? "Original article", external: true };

  const lang = wikipedia[1];
  if (!lang || !isSupportedLanguage(lang)) return null;
  let pathname: string;
  try {
    pathname = new URL(submission.url).pathname;
  } catch {
    return null;
  }
  const article = pathname.startsWith("/wiki/") ? titleFromWikiHref(pathname, lang) : null;
  return article ? { href: articlePath(article.title, undefined, lang), label: `${article.title} in WikiHole`, external: false } : null;
}
