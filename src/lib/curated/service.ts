import "server-only";
import { readingMinutes } from "@/lib/discovery/score";
import { getPagesMetaMap } from "@/lib/wikipedia/api";
import { wikipediaUrl } from "@/lib/wikipedia/titles";
import type { Thumbnail } from "@/lib/wikipedia/types";
import { COLLECTIONS, type CollectionId } from "./rank";
import { getCatalogue, getProvenance, getRecommended } from "./store";
import type { CatalogueEntry, RecommendedArticle } from "./types";

/**
 * Joins the two datasets for display. The numbers come from the snapshot; the
 * intro and thumbnail come live from Wikipedia, through the same cached client
 * as every other page. If Wikipedia cannot be reached, entries still render from
 * the snapshot's short description.
 */

export interface CuratedItem {
  pageId: number;
  title: string;
  url: string;
  description?: string;
  extract?: string;
  thumbnail?: Thumbnail;
  readingMinutes?: number;
  assessment?: string;
  monthlyClicks?: number;
  incomingLinks?: number;
  topics?: string[];
  instanceOf?: string[];
  sources?: string[];
  interest?: number;
  recommendation?: RecommendedArticle;
}

export interface CuratedPage {
  items: CuratedItem[];
  total: number;
  nextOffset: number | null;
}

async function hydrate(seeds: Array<{ id: number; title: string }>): Promise<CuratedItem[]> {
  const { byId: catalogue } = getCatalogue();
  const { byId: recommended } = getRecommended();
  const metas = await getPagesMetaMap(seeds.map((seed) => seed.title)).catch(() => new Map());
  return seeds.map(({ id, title }) => {
    const entry = catalogue.get(id);
    const meta = metas.get(title) ?? null;
    return {
      pageId: id,
      title: meta?.title ?? title,
      url: wikipediaUrl(meta?.title ?? title),
      ...(meta?.description || entry?.description ? { description: meta?.description ?? entry?.description } : {}),
      ...(meta?.extract ? { extract: meta.extract } : {}),
      ...(meta?.thumbnail ? { thumbnail: meta.thumbnail } : {}),
      ...(meta ? { readingMinutes: readingMinutes(meta) } : {}),
      ...(meta?.assessment || entry?.assessment ? { assessment: meta?.assessment ?? entry?.assessment } : {}),
      ...(entry?.monthlyClicks !== undefined ? { monthlyClicks: entry.monthlyClicks } : {}),
      ...(entry?.incomingLinks !== undefined ? { incomingLinks: entry.incomingLinks } : {}),
      ...(entry?.topics ? { topics: entry.topics } : {}),
      ...(entry?.instanceOf ? { instanceOf: entry.instanceOf } : {}),
      ...(entry?.sources ? { sources: entry.sources } : {}),
      ...(entry?.interest !== undefined ? { interest: entry.interest } : {}),
      ...(recommended.get(id) ? { recommendation: recommended.get(id) } : {}),
    };
  });
}

export function hasRecommendations(): boolean {
  return getRecommended().byId.size > 0;
}

/** The first collection that has articles, so the Recommended page never opens on an empty one. */
export function defaultCollection(): CollectionId {
  const { collections } = getRecommended();
  return COLLECTIONS.find((id) => (collections?.[id]?.length ?? 0) > 0) ?? COLLECTIONS[0];
}

export async function getCollection(id: CollectionId, offset = 0, limit = 12): Promise<CuratedPage> {
  const { collections, byId } = getRecommended();
  const ids = collections?.[id] ?? [];
  const slice = ids.slice(offset, offset + limit).flatMap((page) => {
    const article = byId.get(page);
    return article ? [{ id: article.id, title: article.title }] : [];
  });
  return {
    items: await hydrate(slice),
    total: ids.length,
    nextOffset: offset + limit < ids.length ? offset + limit : null,
  };
}

export function getRecommendation(pageId: number): RecommendedArticle | undefined {
  return getRecommended().byId.get(pageId);
}

export function getSources(pageId: number) {
  return (getProvenance().get(pageId) ?? []).map(([url, at, community, decidedBy]) => ({ url, at, community, decidedBy })).sort((a, b) => b.at - a.at);
}

/* ------------------------------------------------------------------------ */
/* Explore Wikipedia: the knowledge dataset                                  */
/* ------------------------------------------------------------------------ */

export const EXPLORE_AREAS = ["Culture", "Geography", "History_and_Society", "STEM"] as const;
export type ExploreArea = (typeof EXPLORE_AREAS)[number];
export const EXPLORE_SORTS = ["surprise", "promising", "quiet"] as const;
export type ExploreSort = (typeof EXPLORE_SORTS)[number];

export interface ExploreRequest {
  query?: string;
  area?: ExploreArea | null;
  sort?: ExploreSort;
  /** Only articles nobody has recommended in the human dataset. */
  unrecommended?: boolean;
  exclude?: number[];
  offset?: number;
  limit?: number;
  random?: () => number;
}

function matches(entry: CatalogueEntry, words: string[]): boolean {
  const haystack = `${entry.title} ${entry.description ?? ""} ${(entry.categories ?? []).join(" ")} ${(entry.instanceOf ?? []).join(" ")}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Diverse random draw: weighted by promise, no more than a few from any one topic. */
function drawDiverse(pool: CatalogueEntry[], limit: number, random: () => number): CatalogueEntry[] {
  // Weighted sampling without replacement (Efraimidis-Spirakis).
  const keyed = pool.map((entry) => ({ entry, key: Math.pow(random(), 1 / Math.max(1, entry.interest)) }));
  keyed.sort((a, b) => b.key - a.key);
  const perTopic = new Map<string, number>();
  const cap = Math.max(2, Math.ceil(limit / 4));
  const picked: CatalogueEntry[] = [];
  for (const { entry } of keyed) {
    if (picked.length >= limit) break;
    const topic = entry.topics?.[0] ?? "none";
    if ((perTopic.get(topic) ?? 0) >= cap) continue;
    perTopic.set(topic, (perTopic.get(topic) ?? 0) + 1);
    picked.push(entry);
  }
  return picked;
}

export async function exploreCatalogue(request: ExploreRequest = {}): Promise<CuratedPage> {
  const { query, area, sort = "surprise", unrecommended, exclude = [], offset = 0, limit = 12, random = Math.random } = request;
  const { entries } = getCatalogue();
  const excluded = new Set(exclude);
  const { byId: recommended } = getRecommended();
  const words = query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  const pool = entries.filter(
    (entry) =>
      !excluded.has(entry.id) &&
      (!area || entry.topics?.some((topic) => topic.startsWith(`${area}.`))) &&
      (!unrecommended || !recommended.has(entry.id)) &&
      (words.length === 0 || matches(entry, words)),
  );
  if (sort === "surprise" && words.length === 0) {
    // Each draw is fresh, and exclude keeps later draws from repeating it.
    const picked = drawDiverse(pool, limit, random);
    return { items: await hydrate(picked), total: pool.length, nextOffset: pool.length > picked.length ? 0 : null };
  }
  const ranked = [...pool].sort((a, b) =>
    sort === "quiet" ? (a.monthlyClicks ?? 0) - (b.monthlyClicks ?? 0) || b.interest - a.interest : b.interest - a.interest,
  );
  const slice = ranked.slice(offset, offset + limit);
  return { items: await hydrate(slice), total: pool.length, nextOffset: offset + limit < pool.length ? offset + limit : null };
}
