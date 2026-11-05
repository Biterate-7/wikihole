import { NextResponse } from "next/server";
import { getExploration } from "@/lib/hackernews/service";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  if (!/^\d{1,10}$/.test(raw)) return jsonError("Invalid Hacker News item id.", 400);
  // Opening an unprocessed submission builds its rabbit hole, so this route is limited more tightly.
  if (!rateLimit(request, "hackernews-item", 12)) return tooManyRequests();
  try {
    const result = await getExploration(Number(raw));
    if (result.status === "notfound") return jsonError("That Hacker News item does not exist.", 404);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
