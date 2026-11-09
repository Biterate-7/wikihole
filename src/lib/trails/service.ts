import "server-only";
import { isAiEnabled } from "@/lib/ai/config";
import { attempt } from "@/lib/server/http";
import { getPagesMetaMap } from "@/lib/wikipedia/api";
import { trailsFrom } from "./graph";
import { resolveTrail, trailTitles } from "./resolve";
import type { ResolvedTrail, TrailDefinition } from "./types";

/**
 * Trails are English Wikipedia articles: the curated wording and the link
 * checks are written against the English edition.
 */
export const TRAIL_LANGUAGE = "en";

/** Whether "Start a trail here" leads anywhere: a curated path goes on from the article, or AI can propose one. */
export function canStartTrail(title: string): boolean {
  return trailsFrom(title).length > 0 || isAiEnabled();
}

/**
 * Adds descriptions and thumbnails from Wikipedia (one batched, cached
 * metadata request). If Wikipedia cannot be reached, the trails are still
 * returned: the cards show their titles and the connections are unchanged.
 */
export async function resolveTrails(trails: TrailDefinition[]): Promise<ResolvedTrail[]> {
  const metas = await attempt(() => getPagesMetaMap(trailTitles(trails), TRAIL_LANGUAGE));
  return trails.map((trail) => resolveTrail(trail, metas.ok ? metas.value : null, canStartTrail));
}
