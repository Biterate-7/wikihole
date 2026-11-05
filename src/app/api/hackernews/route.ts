import { NextResponse } from "next/server";
import { z } from "zod";
import { FEED_CATEGORIES, getHackerNewsFeed } from "@/lib/hackernews/service";
import { errorResponse, jsonError, rateLimit, runAfter, tooManyRequests } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  category: z.enum(FEED_CATEGORIES).default("all"),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(30).default(15),
});

export async function GET(request: Request) {
  if (!rateLimit(request, "hackernews", 30)) return tooManyRequests();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return jsonError("Invalid Hacker News feed request.", 400);
  try {
    // Follow-up builds run after the response, within the shared Wikipedia budget.
    const feed = await getHackerNewsFeed({ ...parsed.data, warmup: parsed.data.offset === 0 ? 1 : 0, schedule: runAfter });
    return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
