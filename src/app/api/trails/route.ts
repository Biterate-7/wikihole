import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAiEnabled } from "@/lib/ai/config";
import { loadArticle } from "@/lib/article";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";
import { TrailGenerationError, generateTrails } from "@/lib/trails/generate";
import { TRAIL_LANGUAGE, resolveTrails } from "@/lib/trails/service";
import { getPagesMetaMap } from "@/lib/wikipedia/api";
import { isArticleNamespace, isValidTitle, normalizeTitle } from "@/lib/wikipedia/titles";

export const maxDuration = 90;

const bodySchema = z.object({ title: z.string().min(1).max(255) });

/**
 * AI-proposed trails from an article that no curated trail passes through.
 * Only trails whose every step verifies against Wikipedia are returned.
 */
export async function POST(request: Request) {
  if (!isAiEnabled()) return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  if (!rateLimit(request, "trails", 6)) return tooManyRequests();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  const title = parsed.success ? normalizeTitle(parsed.data.title) : "";
  if (!isValidTitle(title) || !isArticleNamespace(title)) return jsonError("Invalid article title.", 400);
  try {
    const start = await loadArticle(title, TRAIL_LANGUAGE);
    const { trails, rejected } = await generateTrails(start, {
      metas: (titles) => getPagesMetaMap(titles, TRAIL_LANGUAGE),
      doc: (t) => loadArticle(t, TRAIL_LANGUAGE),
    });
    return NextResponse.json({ enabled: true, trails: await resolveTrails(trails), rejected }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TrailGenerationError) {
      const status = error.code === "disabled" ? 404 : error.code === "refused" ? 422 : 502;
      return jsonError(error.message, status);
    }
    if (error instanceof Anthropic.RateLimitError) return jsonError("The AI provider is busy. Try again shortly.", 503);
    if (error instanceof Anthropic.APIError) return jsonError("The AI provider is unavailable.", 502);
    return errorResponse(error);
  }
}
