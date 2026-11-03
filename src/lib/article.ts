import "server-only";
import { cache } from "react";
import { TtlCache } from "@/lib/cache";
import { parseArticle } from "@/lib/content/parse";
import type { ArticleDocument } from "@/lib/content/types";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { getPageMeta, getParsedHtml, getSummary } from "@/lib/wikipedia/api";
import type { PageMeta, PageSummary } from "@/lib/wikipedia/types";

/**
 * Article loading for the reader. React `cache` de-duplicates calls within a
 * single render (several Suspense boundaries share one fetch); the TTL caches
 * persist parsed documents across requests within a server instance.
 *
 * Every loader takes the language edition explicitly: `cache` keys on the
 * exact arguments, so an implicit default would split the memoisation.
 */

const docCache = new TtlCache<ArticleDocument>(120, 30 * 60 * 1000);

async function buildDocument(title: string, lang: string, section?: number): Promise<ArticleDocument> {
  const page = await getParsedHtml(title, section, lang);
  return docCache.getOrLoad(`${lang}|${page.pageId}|${page.revId}|${section ?? "all"}`, async () =>
    parseArticle({
      title: page.title,
      displayTitle: page.displayTitle,
      pageId: page.pageId,
      revId: page.revId,
      html: page.html,
      categories: page.categories.filter((c) => !c.hidden).map((c) => c.name),
      lang,
    }),
  );
}

/** Full parsed article. */
export const loadArticle = cache((title: string, lang: string) => buildDocument(title, lang));

/**
 * Full parsed article outside a React render (background jobs such as rabbit-hole building).
 * Hacker News rabbit holes are built from English Wikipedia, hence the default edition.
 */
export function fetchArticleDocument(title: string, lang: string = DEFAULT_LANGUAGE): Promise<ArticleDocument> {
  return buildDocument(title, lang);
}

/** Only the lead section: small and fast, so the reader can stream it first. */
export const loadLead = cache((title: string, lang: string) => buildDocument(title, lang, 0));

export const loadMeta = cache((title: string, lang: string): Promise<PageMeta | null> => getPageMeta(title, lang));

export const loadSummary = cache(
  (title: string, lang: string): Promise<PageSummary | null> => getSummary(title, lang).catch(() => null),
);
