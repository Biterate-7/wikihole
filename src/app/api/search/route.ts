import { NextResponse } from "next/server";
import { searchSuggestions } from "@/lib/wikipedia/api";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  if (q.length > 200) return jsonError("Query is too long.", 400);
  if (!rateLimit(request, "search", 90)) return tooManyRequests();
  try {
    const results = await searchSuggestions(q, 8);
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
