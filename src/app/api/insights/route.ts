import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAiEnabled } from "@/lib/ai/config";
import { generateInsights, InsightsError } from "@/lib/ai/insights";
import { loadArticle } from "@/lib/article";
import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/lib/i18n/languages";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";
import { isValidTitle, normalizeTitle } from "@/lib/wikipedia/titles";

export const maxDuration = 60;

const bodySchema = z.object({ title: z.string().min(1).max(255), lang: z.string().max(20).optional() });

export async function POST(request: Request) {
  if (!isAiEnabled()) return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  if (!rateLimit(request, "insights", 6)) return tooManyRequests();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  const title = parsed.success ? normalizeTitle(parsed.data.title) : "";
  if (!isValidTitle(title)) return jsonError("Invalid article title.", 400);
  const lang = parsed.success ? (parsed.data.lang ?? DEFAULT_LANGUAGE) : DEFAULT_LANGUAGE;
  if (!isSupportedLanguage(lang)) return jsonError("Unsupported language.", 400);
  try {
    const doc = await loadArticle(title, lang);
    const insights = await generateInsights(doc);
    return NextResponse.json({ enabled: true, insights }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InsightsError) {
      const status = error.code === "disabled" ? 404 : error.code === "refused" ? 422 : 502;
      return jsonError(error.message, status);
    }
    if (error instanceof Anthropic.RateLimitError) return jsonError("The AI provider is busy. Try again shortly.", 503);
    if (error instanceof Anthropic.APIError) return jsonError("The AI provider is unavailable.", 502);
    return errorResponse(error);
  }
}
