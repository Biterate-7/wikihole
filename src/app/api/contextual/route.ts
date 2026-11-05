import { NextResponse } from "next/server";
import { z } from "zod";
import { getContextual } from "@/lib/discovery/engine";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";

/**
 * Suggestions from titles the browser sends from its own local history. They
 * are used for this response and not stored or logged.
 */
const bodySchema = z.object({
  titles: z.array(z.string().min(1).max(300)).min(1).max(8),
  exclude: z.array(z.number().int().nonnegative()).max(1000).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

export async function POST(request: Request) {
  if (!rateLimit(request, "contextual", 20)) return tooManyRequests();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid request.", 400);
  try {
    const items = await getContextual(parsed.data.titles, parsed.data.exclude ?? [], parsed.data.limit ?? 12);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
