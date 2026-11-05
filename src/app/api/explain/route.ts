import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAiEnabled } from "@/lib/ai/config";
import { EXPLAIN_LEVELS, PASSAGE_ACTIONS, type Explanation, type ExplainRequest } from "@/lib/ai/explain-types";
import { ExplainError, explainDiff, explainPassage, explainTerm, summariseSection } from "@/lib/ai/explain";
import { loadArticle, loadSummary } from "@/lib/article";
import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/lib/i18n/languages";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";
import { diffPlainText } from "@/lib/wikipedia/diff";
import { compareRevisions, ComparisonError } from "@/lib/wikipedia/revisions";
import { isValidTitle, normalizeTitle } from "@/lib/wikipedia/titles";

export const maxDuration = 60;

const article = { title: z.string().min(1).max(255), lang: z.string().max(20).optional() };
const revisionId = z.number().int().positive();

const bodySchema: z.ZodType<ExplainRequest> = z.discriminatedUnion("kind", [
  z.object({
    ...article,
    kind: z.literal("term"),
    term: z.string().min(1).max(120),
    link: z.string().max(255).optional(),
    sectionId: z.string().max(255).optional(),
    level: z.enum(EXPLAIN_LEVELS),
    deeper: z.boolean().optional(),
  }),
  z.object({
    ...article,
    kind: z.literal("passage"),
    action: z.enum(PASSAGE_ACTIONS),
    passage: z.string().min(1).max(4000),
    links: z.array(z.string().max(255)).max(30).optional(),
  }),
  z.object({ ...article, kind: z.literal("section"), sectionId: z.string().min(1).max(255) }),
  z.object({ ...article, kind: z.literal("diff"), from: revisionId.optional(), to: revisionId }),
]);

async function run(body: ExplainRequest, title: string, lang: string): Promise<Explanation> {
  switch (body.kind) {
    case "diff": {
      const comparison = await compareRevisions(title, body.to, body.from, lang);
      const summary = comparison.to.summary;
      return explainDiff(
        title,
        `${lang}|${title}|${comparison.from?.id ?? "first"}|${comparison.to.id}`,
        diffPlainText(comparison.rows),
        summary ? [summary.section, summary.text].filter(Boolean).join(": ") : null,
      );
    }
    case "term": {
      const doc = await loadArticle(title, lang);
      // The linked page's own introduction gives the model something beyond the sentence the term sits in.
      const known = body.link ? doc.links.find((l) => l.title.toLowerCase() === body.link?.toLowerCase())?.title : undefined;
      const summary = known ? await loadSummary(known, lang) : null;
      return explainTerm(doc, { ...body, link: known }, summary?.extract ?? null);
    }
    case "passage":
      return explainPassage(await loadArticle(title, lang), body);
    case "section":
      return summariseSection(await loadArticle(title, lang), body.sectionId);
  }
}

export async function POST(request: Request) {
  if (!isAiEnabled()) return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  if (!rateLimit(request, "explain", 30)) return tooManyRequests();
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return jsonError("Invalid explanation request.", 400);
  const title = normalizeTitle(parsed.data.title);
  if (!isValidTitle(title)) return jsonError("Invalid article title.", 400);
  const lang = parsed.data.lang ?? DEFAULT_LANGUAGE;
  if (!isSupportedLanguage(lang)) return jsonError("Unsupported language.", 400);
  try {
    const explanation = await run(parsed.data, title, lang);
    return NextResponse.json({ enabled: true, explanation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ComparisonError) return jsonError(error.message, 400);
    if (error instanceof ExplainError) {
      const status = error.code === "disabled" ? 404 : error.code === "invalid" ? 400 : error.code === "refused" ? 422 : 502;
      return jsonError(error.message, status);
    }
    if (error instanceof Anthropic.RateLimitError) return jsonError("The AI provider is busy. Try again shortly.", 503);
    if (error instanceof Anthropic.APIError) return jsonError("The AI provider is unavailable.", 502);
    return errorResponse(error);
  }
}
