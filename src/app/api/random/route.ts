import { NextResponse } from "next/server";
import { z } from "zod";
import { getRandomDiscovery } from "@/lib/discovery/engine";
import { isTopicSlug } from "@/lib/discovery/topics";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";

const bodySchema = z.object({
  exclude: z.array(z.number().int().nonnegative()).max(1000).optional(),
  topic: z.string().max(64).nullable().optional(),
});

export async function POST(request: Request) {
  if (!rateLimit(request, "random", 20)) return tooManyRequests();
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is fine: no exclusions, any topic.
  }
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) return jsonError("Invalid random request.", 400);
  const topic = parsed.data.topic ?? null;
  if (topic && !isTopicSlug(topic)) return jsonError("Unknown topic.", 400);
  try {
    const result = await getRandomDiscovery({ exclude: parsed.data.exclude ?? [], topic });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
