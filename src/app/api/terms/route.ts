import { NextResponse } from "next/server";
import { loadArticle } from "@/lib/article";
import { TtlCache } from "@/lib/cache";
import { rankLinks } from "@/lib/content/concepts";
import { selectTerms, TERM_CANDIDATES, type ReaderTerm } from "@/lib/content/terms";
import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/lib/i18n/languages";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";
import { getPagesMetaMap } from "@/lib/wikipedia/api";
import { isValidTitle, normalizeTitle } from "@/lib/wikipedia/titles";

const cache = new TtlCache<ReaderTerm[]>(500, 6 * 60 * 60 * 1000);

/** Which terms the reader can explain in an article, with Wikipedia's own description of each. */
export async function GET(request: Request) {
  if (!rateLimit(request, "terms", 60)) return tooManyRequests();
  const url = new URL(request.url);
  const title = normalizeTitle(url.searchParams.get("title") ?? "");
  if (!isValidTitle(title)) return jsonError("Invalid article title.", 400);
  const lang = url.searchParams.get("lang") ?? DEFAULT_LANGUAGE;
  if (!isSupportedLanguage(lang)) return jsonError("Unsupported language.", 400);
  try {
    const doc = await loadArticle(title, lang);
    const terms = await cache.getOrLoad(`${lang}|${doc.pageId}|${doc.revId}`, async () => {
      const candidates = rankLinks(doc.links).slice(0, TERM_CANDIDATES);
      return selectTerms(doc, await getPagesMetaMap(candidates.map((l) => l.title), lang));
    });
    return NextResponse.json({ terms }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return errorResponse(error);
  }
}
