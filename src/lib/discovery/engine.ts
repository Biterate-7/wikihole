import "server-only";
import { TtlCache } from "@/lib/cache";
import { rankLinks } from "@/lib/content/concepts";
import type { ArticleDocument } from "@/lib/content/types";
import { getMoreLike, getPagesMeta, getPagesMetaMap, getRandomTitles, searchCandidates } from "@/lib/wikipedia/api";
import type { PageMeta } from "@/lib/wikipedia/types";
import { MODEL, normalizeWeights, weightsFor } from "./config";
import { DATE_TITLE, LIST_TITLE, NUMBER_TITLE } from "./lexicon";
import { extractFeatures, rejectReason, topCategories, type Candidate } from "./score";
import { selectDiverse, type Scored } from "./select";
import { GROUPS, allSubtopics, resolveTopic, type Subtopic } from "./topics";
import type { Discovery, FeedPreset, PoolStats, RejectReason, RelationSource } from "./types";

/* ------------------------------------------------------------------------ */
/* Candidate pools                                                           */
/* ------------------------------------------------------------------------ */

interface Pool {
  entries: Map<number, Scored>;
  stats: PoolStats;
  lastFetch: number;
  refills: number;
}

const POOL_TTL_MS = 20 * 60 * 1000;
const POOL_CAP = 400;
const pools = new TtlCache<Pool>(200, POOL_TTL_MS);
const refilling = new Map<string, Promise<void>>();

function emptyStats(): PoolStats {
  return { sampled: 0, accepted: 0, rejected: {} };
}

function countReject(stats: PoolStats, reason: RejectReason, n = 1): void {
  stats.rejected[reason] = (stats.rejected[reason] ?? 0) + n;
}

function mergeStats(target: PoolStats, source: PoolStats): void {
  target.sampled += source.sampled;
  target.accepted += source.accepted;
  for (const [reason, n] of Object.entries(source.rejected) as Array<[RejectReason, number]>) countReject(target, reason, n);
}

/** Scores and gates metadata for feed use, recording why candidates were rejected. */
function admit(metas: PageMeta[], stats: PoolStats, subtopic?: string): Scored[] {
  const accepted: Scored[] = [];
  for (const meta of metas) {
    const features = extractFeatures(meta);
    const reason = rejectReason(meta, features);
    if (reason) {
      countReject(stats, reason);
      continue;
    }
    stats.accepted++;
    const exploration = subtopic ? (features.group && GROUPS.find((g) => g.id === features.group)?.subtopics.includes(subtopic) ? 1 : 0.6) : 0.5;
    accepted.push({ candidate: { meta, subtopic, exploration }, features });
  }
  return accepted;
}

function categoryQuery(sub: Subtopic): string {
  return `incategory:${sub.categories.map((c) => c.replace(/ /g, "_")).join("|")}`;
}

/**
 * Pulls a fresh random sample from a subtopic's categories: one randomly
 * sorted search for titles, then one metadata batch for the 20 most promising
 * (random sort is not stable across continuations, so metadata is fetched by
 * fixed titles rather than through a search generator).
 */
async function sampleSubtopic(sub: Subtopic): Promise<{ entries: Scored[]; stats: PoolStats }> {
  const stats = emptyStats();
  const hits = await searchCandidates(categoryQuery(sub), { limit: 50, sort: "random" });
  stats.sampled += hits.length;
  const prelim = hits.filter((h) => {
    if (LIST_TITLE.test(h.title)) return countReject(stats, "list"), false;
    if (DATE_TITLE.test(h.title) || NUMBER_TITLE.test(h.title)) return countReject(stats, "date"), false;
    if (h.size < MODEL.minLengthBytes) return countReject(stats, "stub"), false;
    return true;
  });
  const batch = prelim.slice(0, 20);
  const wordCounts = new Map(batch.map((h) => [h.pageId, h.wordCount]));
  const metas = await getPagesMeta(batch.map((h) => h.title));
  const withWords = metas.map((m) => ({ ...m, wordCount: wordCounts.get(m.pageId) || m.wordCount }));
  return { entries: admit(withWords, stats, sub.slug), stats };
}

async function refill(sub: Subtopic, pool: Pool): Promise<void> {
  const key = sub.slug;
  const pending = refilling.get(key);
  if (pending) return pending;
  const run = (async () => {
    const { entries, stats } = await sampleSubtopic(sub);
    for (const entry of entries) {
      if (pool.entries.size >= POOL_CAP) break;
      pool.entries.set(entry.candidate.meta.pageId, entry);
    }
    mergeStats(pool.stats, stats);
    pool.lastFetch = Date.now();
    pool.refills++;
  })().finally(() => refilling.delete(key));
  refilling.set(key, run);
  return run;
}

async function getPool(sub: Subtopic, exclude: Set<number>, wanted: number): Promise<Pool> {
  let pool = pools.get(sub.slug);
  if (!pool) {
    pool = { entries: new Map(), stats: emptyStats(), lastFetch: 0, refills: 0 };
    await refill(sub, pool);
    pools.set(sub.slug, pool);
    return pool;
  }
  const unseen = [...pool.entries.keys()].filter((id) => !exclude.has(id)).length;
  if (unseen < wanted && pool.refills < 12 && Date.now() - pool.lastFetch > 2000) {
    await refill(sub, pool);
  }
  return pool;
}

function shuffle<T>(items: T[], random = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Picks subtopics to sample, spreading across groups when browsing everything. */
function chooseSubtopics(subs: Subtopic[], count: number, spreadGroups: boolean): Subtopic[] {
  if (!spreadGroups) return shuffle(subs).slice(0, count);
  const chosen: Subtopic[] = [];
  for (const group of shuffle(GROUPS)) {
    const options = group.subtopics.filter((s) => !chosen.some((c) => c.slug === s));
    const slug = shuffle(options)[0];
    const sub = subs.find((s) => s.slug === slug);
    if (sub) chosen.push(sub);
    if (chosen.length >= count) break;
  }
  return chosen;
}

/* ------------------------------------------------------------------------ */
/* Feed                                                                      */
/* ------------------------------------------------------------------------ */

export interface FeedRequest {
  topic?: string | null;
  preset?: FeedPreset;
  exclude?: number[];
  limit?: number;
}

export interface FeedResponse {
  items: Discovery[];
  topic: string | null;
  preset: FeedPreset;
  stats: PoolStats;
  exhausted: boolean;
}

export async function getFeed(request: FeedRequest = {}): Promise<FeedResponse> {
  const limit = Math.min(Math.max(request.limit ?? 12, 1), 30);
  const preset = request.preset ?? "balanced";
  const exclude = new Set(request.exclude ?? []);
  const topic = resolveTopic(request.topic);
  const available = topic ? topic.subtopics : allSubtopics();
  // Few sources per request keeps us well inside Wikimedia's per-client rate limit;
  // pools are cached, so successive pages rotate through other subtopics.
  const chosen = chooseSubtopics(available, topic?.kind === "subtopic" ? 1 : 4, !topic);
  const perPool = Math.ceil((limit * 1.5) / chosen.length);

  const settled = await Promise.allSettled(chosen.map((sub) => getPool(sub, exclude, perPool)));
  const fulfilled = settled.filter((s): s is PromiseFulfilledResult<Pool> => s.status === "fulfilled");
  if (fulfilled.length === 0) {
    const firstError = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    throw firstError?.reason ?? new Error("No discovery sources available");
  }

  const stats = emptyStats();
  const unique = new Map<number, Scored>();
  for (const { value: pool } of fulfilled) {
    mergeStats(stats, pool.stats);
    for (const [id, entry] of pool.entries) if (!exclude.has(id) && !unique.has(id)) unique.set(id, entry);
  }

  const items = selectDiverse([...unique.values()], weightsFor(preset), {
    limit,
    noise: MODEL.explorationNoise,
    maxPerCluster: Math.max(2, Math.ceil(limit / chosen.length)),
  });
  return { items, topic: topic?.slug ?? null, preset, stats, exhausted: unique.size <= items.length };
}

/* ------------------------------------------------------------------------ */
/* Random discovery                                                          */
/* ------------------------------------------------------------------------ */

export interface RandomResponse {
  discovery: Discovery | null;
  queue: Discovery[];
  stats: PoolStats & { uniformSample: number; uniformAccepted: number };
}

/**
 * Draws a uniformly random sample of Wikipedia (Special:Random) alongside
 * random samples from the technical categories, runs everything through the
 * same quality gate and ranking, then picks among the strongest candidates.
 */
export async function getRandomDiscovery({ exclude = [] as number[], topic = null as string | null } = {}): Promise<RandomResponse> {
  const excluded = new Set(exclude);
  const resolved = resolveTopic(topic);
  const subs = chooseSubtopics(resolved ? resolved.subtopics : allSubtopics(), 2, !resolved);

  const uniformStats = emptyStats();
  const [uniform, ...pooled] = await Promise.allSettled([
    (async () => {
      const titles = await getRandomTitles(20);
      uniformStats.sampled = titles.length;
      return admit(await getPagesMeta(titles), uniformStats);
    })(),
    ...subs.map(async (sub) => {
      const fresh = await sampleSubtopic(sub);
      const pool = pools.get(sub.slug);
      if (pool) for (const e of fresh.entries) if (pool.entries.size < POOL_CAP) pool.entries.set(e.candidate.meta.pageId, e);
      return fresh;
    }),
  ]);

  const stats = emptyStats();
  const candidates = new Map<number, Scored>();
  if (uniform.status === "fulfilled") {
    mergeStats(stats, uniformStats);
    for (const s of uniform.value) candidates.set(s.candidate.meta.pageId, s);
  }
  for (const result of pooled) {
    if (result.status !== "fulfilled") continue;
    mergeStats(stats, result.value.stats);
    for (const s of result.value.entries) candidates.set(s.candidate.meta.pageId, s);
  }
  if (uniform.status === "rejected" && pooled.every((p) => p.status === "rejected")) {
    throw uniform.reason;
  }

  const eligible = [...candidates.values()].filter((s) => !excluded.has(s.candidate.meta.pageId));
  const ranked = selectDiverse(eligible, weightsFor("balanced"), {
    limit: 6,
    noise: MODEL.explorationNoise * 1.5,
    maxPerCluster: 2,
  });
  return {
    discovery: ranked[0] ?? null,
    queue: ranked.slice(1),
    stats: { ...stats, uniformSample: uniformStats.sampled, uniformAccepted: uniformStats.accepted },
  };
}

/* ------------------------------------------------------------------------ */
/* Rabbit Hole: related articles                                             */
/* ------------------------------------------------------------------------ */

const RELATED_WEIGHTS = normalizeWeights({
  technical: 15,
  quality: 20,
  depth: 15,
  obscurity: 10,
  diversity: 10,
  exploration: 30,
});

const relatedCache = new TtlCache<Discovery[]>(300, 30 * 60 * 1000);

interface RelatedSeed {
  title: string;
  relation: RelationSource;
  strength: number;
}

export async function getRelated(doc: ArticleDocument, limit = 14): Promise<Discovery[]> {
  return relatedCache.getOrLoad(`${doc.pageId}|${doc.revId}|${limit}`, async () => {
    const seeds = new Map<string, RelatedSeed>();
    const add = (seed: RelatedSeed) => {
      const existing = seeds.get(seed.title);
      if (!existing || existing.strength < seed.strength) seeds.set(seed.title, seed);
    };

    doc.seeAlso.slice(0, 15).forEach((title) =>
      add({ title, strength: 1, relation: { kind: "see-also", label: "Listed under See also" } }),
    );
    for (const link of rankLinks(doc.links).slice(0, 40)) {
      if (link.inLead) {
        add({
          title: link.title,
          strength: 0.85 + Math.min(0.15, link.count * 0.03),
          relation: { kind: "lead-link", label: "Linked from the introduction" },
        });
      } else {
        add({
          title: link.title,
          strength: 0.45 + Math.min(0.25, link.count * 0.05),
          relation: {
            kind: "body-link",
            label: link.sectionTitle ? `Linked in “${link.sectionTitle}”` : "Linked in the article",
            ...(link.sectionTitle ? { evidence: link.sectionTitle } : {}),
          },
        });
      }
    }
    const similar = await getMoreLike(doc.title, 12).catch(() => []);
    similar.forEach((hit, rank) =>
      add({
        title: hit.title,
        strength: 0.8 - rank * 0.025,
        relation: { kind: "similar-text", label: "Textually similar (CirrusSearch more-like)" },
      }),
    );

    const titles = [...seeds.keys()].slice(0, 60);
    const metaByTitle = await getPagesMetaMap(titles);
    const sourceCategories = new Set(topCategories(doc.categories, 50).map((c) => c.toLowerCase()));
    const scored = new Map<number, Scored>();
    for (const title of titles) {
      const meta = metaByTitle.get(title);
      const seed = seeds.get(title);
      if (!meta || !seed || meta.pageId === doc.pageId) continue;
      const features = extractFeatures(meta);
      if (rejectReason(meta, features, { strict: false })) continue;
      if (meta.assessment === "Stub" || meta.length < 2500) features.penalty *= 0.6;
      if (features.technical < MODEL.minTechnical) features.penalty *= 0.7;

      const shared = meta.categories.find((c) => sourceCategories.has(c.toLowerCase()));
      let relation = seed.relation;
      let strength = seed.strength;
      if (shared) {
        strength = Math.min(1, strength + 0.15);
        features.signals.unshift(`Shares category “${shared}”`);
        if (relation.kind === "body-link" || relation.kind === "similar-text") {
          relation = { kind: "shared-category", label: `Shares category “${shared}”`, evidence: shared };
        }
      }
      const candidate: Candidate = { meta, relation, exploration: strength };
      const existing = scored.get(meta.pageId);
      if (!existing || existing.candidate.exploration < strength) scored.set(meta.pageId, { candidate, features });
    }
    return selectDiverse([...scored.values()], RELATED_WEIGHTS, { limit, noise: 0, maxPerCluster: 5 });
  });
}

