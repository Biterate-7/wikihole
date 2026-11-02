import { NextResponse } from "next/server";
import { z } from "zod";
import { getFeed } from "@/lib/discovery/engine";
import { isTopicSlug } from "@/lib/discovery/topics";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";

const bodySchema = z.object({
  topic: z.string().max(64).nullable().optional(),
  preset: z.enum(["balanced", "deep", "obscure"]).optional(),
  exclude: z.array(z.number().int().nonnegative()).max(1000).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

export async function POST(request: Request) {
  if (!rateLimit(request, "feed", 40)) return tooManyRequests();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid feed request.", 400);
  const { topic, ...rest } = parsed.data;
  if (topic && !isTopicSlug(topic)) return jsonError("Unknown topic.", 400);
  try {
    const feed = await getFeed({ topic: topic ?? null, ...rest });
    return NextResponse.json(feed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
