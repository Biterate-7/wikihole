import { NextResponse } from "next/server";
import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/lib/i18n/languages";
import { searchSuggestions } from "@/lib/wikipedia/api";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const lang = params.get("lang") || DEFAULT_LANGUAGE;
  if (!isSupportedLanguage(lang)) return jsonError("Unsupported language.", 400);
  if (q.length < 2) return NextResponse.json({ results: [] });
  if (q.length > 200) return jsonError("Query is too long.", 400);
  if (!rateLimit(request, "search", 90)) return tooManyRequests();
  try {
    const results = await searchSuggestions(q, 8, lang);
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
