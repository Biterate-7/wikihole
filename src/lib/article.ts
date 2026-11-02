import "server-only";
import { cache } from "react";
import { TtlCache } from "@/lib/cache";
import { parseArticle } from "@/lib/content/parse";
import type { ArticleDocument } from "@/lib/content/types";
import { getPageMeta, getParsedHtml, getSummary } from "@/lib/wikipedia/api";
import type { PageMeta, PageSummary } from "@/lib/wikipedia/types";

/**
 * Article loading for the reader. React `cache` de-duplicates calls within a
 * single render (several Suspense boundaries share one fetch); the TTL caches
 * persist parsed documents across requests within a server instance.
 */

const docCache = new TtlCache<ArticleDocument>(120, 30 * 60 * 1000);

async function buildDocument(title: string, section?: number): Promise<ArticleDocument> {
  const page = await getParsedHtml(title, section);
  return docCache.getOrLoad(`${page.pageId}|${page.revId}|${section ?? "all"}`, async () =>
    parseArticle({
      title: page.title,
      displayTitle: page.displayTitle,
      pageId: page.pageId,
      revId: page.revId,
      html: page.html,
      categories: page.categories.filter((c) => !c.hidden).map((c) => c.name),
    }),
  );
}

/** Full parsed article. */
export const loadArticle = cache((title: string) => buildDocument(title));

/** Only the lead section: small and fast, so the reader can stream it first. */
export const loadLead = cache((title: string) => buildDocument(title, 0));

export const loadMeta = cache((title: string): Promise<PageMeta | null> => getPageMeta(title));

export const loadSummary = cache((title: string): Promise<PageSummary | null> => getSummary(title).catch(() => null));
