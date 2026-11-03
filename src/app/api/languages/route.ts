import { NextResponse } from "next/server";
import { allLanguages, isSupportedLanguage } from "@/lib/i18n/languages";
import { getSiteStatistics } from "@/lib/wikipedia/api";
import { jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";

/**
 * GET /api/languages?codes=en,ja — live article counts per edition, from
 * each wiki's own siteinfo statistics (cached for 12 hours). An edition that
 * cannot be reached reports `articles: null`; nothing is estimated.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("codes");
  const codes = raw ? [...new Set(raw.split(",").map((c) => c.trim()).filter(Boolean))] : allLanguages().map((l) => l.code);
  if (codes.length > 100) return jsonError("Too many languages.", 400);
  if (!codes.every(isSupportedLanguage)) return jsonError("Unsupported language.", 400);
  if (!rateLimit(request, "languages", 30)) return tooManyRequests();

  const settled = await Promise.allSettled(codes.map((code) => getSiteStatistics(code)));
  const languages = codes.map((code, i) => {
    const result = settled[i];
    return { code, articles: result.status === "fulfilled" ? result.value.articles : null };
  });
  const complete = languages.every((l) => l.articles !== null);
  return NextResponse.json(
    { languages },
    { headers: { "Cache-Control": complete ? "public, max-age=3600, s-maxage=43200, stale-while-revalidate=86400" : "no-store" } },
  );
}
