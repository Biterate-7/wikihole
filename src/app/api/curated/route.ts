import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { COLLECTIONS } from "@/lib/curated/rank";
import { EXPLORE_AREAS, EXPLORE_SORTS, exploreCatalogue, getCollection, getSources } from "@/lib/curated/service";
import { errorResponse, jsonError, rateLimit, tooManyRequests } from "@/lib/server/http";

/** GET /api/curated?collection=hidden&offset=12 or GET /api/curated?sources=<pageId> */
const collectionSchema = z.object({
  collection: z.enum(COLLECTIONS),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

export async function GET(request: NextRequest) {
  if (!rateLimit(request, "curated", 60)) return tooManyRequests();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  if (params.sources !== undefined) {
    const id = Number(params.sources);
    if (!Number.isInteger(id) || id <= 0) return jsonError("Invalid page id.", 400);
    return NextResponse.json({ sources: getSources(id) }, { headers: { "Cache-Control": "public, max-age=3600" } });
  }
  const parsed = collectionSchema.safeParse(params);
  if (!parsed.success) return jsonError("Unknown collection.", 400);
  try {
    const { collection, offset, limit } = parsed.data;
    return NextResponse.json(await getCollection(collection, offset, limit), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

const exploreSchema = z.object({
  query: z.string().max(120).optional(),
  area: z.enum(EXPLORE_AREAS).nullable().optional(),
  sort: z.enum(EXPLORE_SORTS).optional(),
  unrecommended: z.boolean().optional(),
  exclude: z.array(z.number().int().nonnegative()).max(1000).optional(),
  offset: z.number().int().min(0).max(100000).optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

/** POST /api/curated explores the catalogue. A POST because the exclude list can be long. */
export async function POST(request: Request) {
  if (!rateLimit(request, "curated", 60)) return tooManyRequests();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }
  const parsed = exploreSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid explore request.", 400);
  try {
    return NextResponse.json(await exploreCatalogue(parsed.data), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
