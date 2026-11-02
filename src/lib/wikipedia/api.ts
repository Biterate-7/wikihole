import "server-only";
import { parse as parseHtml, HTMLElement, TextNode } from "node-html-parser";
import { z } from "zod";
import { TtlCache } from "@/lib/cache";
import { normalizeMediaUrl } from "@/lib/content/media";
import { fetchJson, mwApi, WikipediaError, WIKIPEDIA_REST_URL, type ApiParams } from "./http";
import { cleanExtract } from "./text";
import { isArticleNamespace, isValidTitle, normalizeTitle, slugFromTitle } from "./titles";
import { PAGEVIEW_DAYS } from "./types";
import type {
  AssessmentClass,
  FullSearchResult,
  PageMeta,
  PageSummary,
  ParsedPageHtml,
  SearchHit,
  SearchSuggestion,
  Thumbnail,
} from "./types";

/* ------------------------------------------------------------------------ */
/* Response schemas (only the fields we use; unknown fields are stripped).  */
/* ------------------------------------------------------------------------ */

const thumbnailSchema = z.object({ source: z.string(), width: z.number(), height: z.number() });

const queryPageSchema = z.object({
  pageid: z.number().optional(),
  ns: z.number().optional(),
  title: z.string(),
  missing: z.boolean().optional(),
  invalid: z.boolean().optional(),
  length: z.number().optional(),
  description: z.string().optional(),
  extract: z.string().optional(),
  thumbnail: thumbnailSchema.optional(),
  pageprops: z.record(z.string(), z.string()).optional(),
  pageassessments: z
    .record(z.string(), z.object({ class: z.string().optional(), importance: z.string().optional() }))
    .optional(),
  pageviews: z.record(z.string(), z.number().nullable()).optional(),
  categories: z.array(z.object({ title: z.string(), hidden: z.boolean().optional() })).optional(),
  revisions: z.array(z.object({ timestamp: z.string().optional() })).optional(),
  index: z.number().optional(),
});
type QueryPage = z.infer<typeof queryPageSchema>;

const queryResponseSchema = z.object({
  batchcomplete: z.boolean().optional(),
  continue: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  query: z
    .object({
      pages: z.array(queryPageSchema).optional(),
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      redirects: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      search: z
        .array(
          z.object({
            ns: z.number(),
            title: z.string(),
            pageid: z.number(),
            size: z.number().optional(),
            wordcount: z.number().optional(),
            timestamp: z.string().optional(),
            snippet: z.string().optional(),
          }),
        )
        .optional(),
      searchinfo: z.object({ totalhits: z.number().optional(), suggestion: z.string().optional() }).optional(),
      random: z.array(z.object({ id: z.number(), ns: z.number(), title: z.string() })).optional(),
    })
    .optional(),
});

const parseResponseSchema = z.object({
  parse: z.object({
    title: z.string(),
    pageid: z.number(),
    revid: z.number(),
    displaytitle: z.string().optional(),
    text: z.string(),
    categories: z.array(z.object({ category: z.string(), hidden: z.boolean().optional() })).optional(),
  }),
});

const summarySchema = z.object({
  type: z.string(),
  title: z.string(),
  description: z.string().optional(),
  extract: z.string(),
  thumbnail: thumbnailSchema.optional(),
  timestamp: z.string().optional(),
});

function validate<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new WikipediaError(`Wikipedia returned malformed ${what} data`, "invalid");
  }
  return result.data;
}

/* ------------------------------------------------------------------------ */
/* Caches                                                                    */
/* ------------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;
const metaCache = new TtlCache<PageMeta | null>(5000, 6 * HOUR);
const searchCache = new TtlCache<SearchSuggestion[]>(500, HOUR);
const fullSearchCache = new TtlCache<FullSearchResult>(300, HOUR);
const parseCache = new TtlCache<ParsedPageHtml>(150, 30 * 60 * 1000);
const summaryCache = new TtlCache<PageSummary>(1000, 6 * HOUR);
const moreLikeCache = new TtlCache<SearchHit[]>(300, 6 * HOUR);

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

const ASSESSMENT_RANK: Record<AssessmentClass, number> = {
  FA: 8,
  FL: 7,
  A: 7,
  GA: 6,
  B: 5,
  C: 4,
  List: 3,
  Start: 2,
  Stub: 1,
  Other: 0,
};

function toAssessment(raw: string | undefined): AssessmentClass | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  const known: AssessmentClass[] = ["FA", "A", "GA", "B", "C", "Start", "Stub", "List", "FL"];
  const match = known.find((k) => k.toLowerCase() === value.toLowerCase());
  return match ?? (value ? "Other" : undefined);
}

/** Picks the project-independent assessment if present, otherwise the best one. */
function bestAssessment(assessments: QueryPage["pageassessments"]): AssessmentClass | undefined {
  if (!assessments) return undefined;
  const independent = assessments["Project-independent assessment"];
  const fromIndependent = toAssessment(independent?.class);
  if (fromIndependent && fromIndependent !== "Other") return fromIndependent;
  let best: AssessmentClass | undefined;
  for (const entry of Object.values(assessments)) {
    const cls = toAssessment(entry.class);
    if (cls && (!best || ASSESSMENT_RANK[cls] > ASSESSMENT_RANK[best])) best = cls;
  }
  return best;
}

function sumViews(pageviews: QueryPage["pageviews"]): number | null {
  if (!pageviews) return null;
  const values = Object.values(pageviews).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0);
}

function toThumbnail(raw: z.infer<typeof thumbnailSchema> | undefined): Thumbnail | undefined {
  const src = normalizeMediaUrl(raw?.source);
  if (!raw || !src) return undefined;
  return { src, width: raw.width, height: raw.height };
}

function toPageMeta(page: QueryPage): PageMeta | null {
  if (page.missing || page.invalid || page.pageid === undefined || page.ns !== 0) return null;
  return {
    pageId: page.pageid,
    title: page.title,
    description: page.description || undefined,
    extract: cleanExtract(page.extract),
    length: page.length ?? 0,
    lastEdited: page.revisions?.[0]?.timestamp,
    thumbnail: toThumbnail(page.thumbnail),
    disambiguation: page.pageprops ? "disambiguation" in page.pageprops : false,
    wikidataId: page.pageprops?.wikibase_item,
    assessment: bestAssessment(page.pageassessments),
    recentViews: sumViews(page.pageviews),
    categories: (page.categories ?? [])
      .filter((c) => !c.hidden)
      .map((c) => c.title.replace(/^Category:/, "")),
  };
}

function mergePage(target: QueryPage, incoming: QueryPage): QueryPage {
  return {
    ...incoming,
    ...target,
    categories: [...(target.categories ?? []), ...(incoming.categories ?? [])],
    pageviews: { ...(target.pageviews ?? {}), ...(incoming.pageviews ?? {}) },
    pageassessments: { ...(target.pageassessments ?? {}), ...(incoming.pageassessments ?? {}) },
    extract: target.extract ?? incoming.extract,
    thumbnail: target.thumbnail ?? incoming.thumbnail,
    description: target.description ?? incoming.description,
    revisions: target.revisions ?? incoming.revisions,
    pageprops: { ...(incoming.pageprops ?? {}), ...(target.pageprops ?? {}) },
  };
}

interface QueryResult {
  pages: QueryPage[];
  aliases: Map<string, string>;
}

/**
 * Runs an action=query request, following `continue` until the current batch
 * is complete. With a generator, stopping at `batchcomplete` avoids silently
 * fetching the generator's next page.
 */
async function queryAll(params: ApiParams, maxRounds = 6): Promise<QueryResult> {
  const pages = new Map<string, QueryPage>();
  const aliases = new Map<string, string>();
  let cont: Record<string, string | number> | undefined;
  for (let round = 0; round < maxRounds; round++) {
    const raw = await mwApi({ action: "query", ...params, ...(cont ?? {}) });
    const data = validate(queryResponseSchema, raw, "query");
    for (const n of data.query?.normalized ?? []) aliases.set(n.from, n.to);
    for (const r of data.query?.redirects ?? []) aliases.set(r.from, r.to);
    for (const page of data.query?.pages ?? []) {
      const key = String(page.pageid ?? page.title);
      const existing = pages.get(key);
      pages.set(key, existing ? mergePage(existing, page) : page);
    }
    if (!data.continue || data.batchcomplete) break;
    cont = data.continue;
  }
  return { pages: [...pages.values()], aliases };
}

function resolveAlias(title: string, aliases: Map<string, string>): string {
  let current = title;
  for (let i = 0; i < 4; i++) {
    const next = aliases.get(current);
    if (!next) break;
    current = next;
  }
  return current;
}

const META_PROPS = {
  prop: "info|pageprops|pageimages|description|extracts|pageassessments|pageviews|categories|revisions",
  ppprop: "disambiguation|wikibase_item",
  exintro: true,
  explaintext: true,
  exsentences: 4,
  exlimit: 20,
  piprop: "thumbnail",
  pithumbsize: 330,
  pilimit: 20,
  palimit: "max",
  pvipdays: PAGEVIEW_DAYS,
  clshow: "!hidden",
  cllimit: "max",
  rvprop: "timestamp",
  redirects: true,
} satisfies ApiParams;

/**
 * CirrusSearch enforces its own per-client rate limit, stricter than the rest
 * of the API, so full-text searches get a smaller concurrency budget.
 */
function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function limit<T>(run: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await run();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
const searchLimiter = createLimiter(3);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Batch-fetches article metadata (description, intro extract, thumbnail,
 * assessment, pageviews, categories, last edit). Results are returned in the
 * order requested; missing pages are omitted. Redirects are followed.
 */
export async function getPagesMeta(titles: string[]): Promise<PageMeta[]> {
  const requested = [...new Set(titles.map(normalizeTitle).filter((t) => isValidTitle(t) && isArticleNamespace(t)))];
  const result = await getPagesMetaMap(requested);
  const seen = new Set<number>();
  const ordered: PageMeta[] = [];
  for (const title of requested) {
    const meta = result.get(title);
    if (meta && !seen.has(meta.pageId)) {
      seen.add(meta.pageId);
      ordered.push(meta);
    }
  }
  return ordered;
}

/** Like getPagesMeta, but keyed by the (normalised) requested title; redirects resolve to their target. */
export async function getPagesMetaMap(titles: string[]): Promise<Map<string, PageMeta | null>> {
  const requested = [...new Set(titles.map(normalizeTitle).filter((t) => isValidTitle(t) && isArticleNamespace(t)))];
  const result = new Map<string, PageMeta | null>();
  const toFetch: string[] = [];
  for (const title of requested) {
    const cached = metaCache.get(title);
    if (cached !== undefined) result.set(title, cached);
    else toFetch.push(title);
  }

  // TextExtracts returns at most 20 intro extracts per request.
  await Promise.all(
    chunk(toFetch, 20).map(async (batch) => {
      const { pages, aliases } = await queryAll({ ...META_PROPS, titles: batch.join("|") });
      const byTitle = new Map<string, PageMeta | null>();
      for (const page of pages) byTitle.set(page.title, toPageMeta(page));
      for (const title of batch) {
        const meta = byTitle.get(resolveAlias(title, aliases)) ?? null;
        metaCache.set(title, meta);
        if (meta) metaCache.set(meta.title, meta);
        result.set(title, meta);
      }
    }),
  );
  return result;
}

export async function getPageMeta(title: string): Promise<PageMeta | null> {
  const [meta] = await getPagesMeta([title]);
  return meta ?? null;
}

/** CirrusSearch full-text search returning lightweight hits (used for candidate generation). */
export async function searchCandidates(
  query: string,
  { limit = 50, sort = "relevance", offset = 0 }: { limit?: number; sort?: "relevance" | "random"; offset?: number } = {},
): Promise<SearchHit[]> {
  const raw = await searchLimiter(() => mwApi({
    action: "query",
    list: "search",
    srsearch: query,
    srnamespace: 0,
    srlimit: Math.min(Math.max(limit, 1), 100),
    sroffset: offset || undefined,
    srsort: sort === "random" ? "random" : undefined,
    srprop: "size|wordcount|timestamp",
    srinfo: "",
  }));
  const data = validate(queryResponseSchema, raw, "search");
  return (data.query?.search ?? [])
    .filter((hit) => hit.ns === 0)
    .map((hit) => ({
      pageId: hit.pageid,
      title: hit.title,
      size: hit.size ?? 0,
      wordCount: hit.wordcount ?? 0,
      timestamp: hit.timestamp,
    }));
}

/** Typeahead search: titles + short descriptions, ordered by relevance. */
export async function searchSuggestions(query: string, limit = 8): Promise<SearchSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const key = `${q.toLowerCase()}|${limit}`;
  return searchCache.getOrLoad(key, async () => {
    const { pages } = await searchLimiter(() => queryAll(
      {
        generator: "search",
        gsrsearch: q,
        gsrnamespace: 0,
        gsrlimit: limit,
        prop: "info|pageprops|pageimages|description",
        ppprop: "disambiguation",
        piprop: "thumbnail",
        pithumbsize: 120,
        pilimit: limit,
      },
      2,
    ));
    return pages
      .filter((p) => p.pageid !== undefined && p.ns === 0)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((p) => ({
        pageId: p.pageid as number,
        title: p.title,
        description: p.description || undefined,
        thumbnail: toThumbnail(p.thumbnail),
        length: p.length ?? 0,
        disambiguation: p.pageprops ? "disambiguation" in p.pageprops : false,
      }));
  });
}

/** Converts a CirrusSearch snippet (HTML with searchmatch spans) into safe runs. */
export function snippetRuns(snippet: string): Array<{ text: string; match: boolean }> {
  const root = parseHtml(snippet);
  const runs: Array<{ text: string; match: boolean }> = [];
  const walk = (nodes: typeof root.childNodes, match: boolean) => {
    for (const node of nodes) {
      if (node instanceof TextNode) {
        const text = node.text;
        if (!text) continue;
        const last = runs[runs.length - 1];
        if (last && last.match === match) last.text += text;
        else runs.push({ text, match });
      } else if (node instanceof HTMLElement) {
        walk(node.childNodes, match || node.classList.contains("searchmatch"));
      }
    }
  };
  walk(root.childNodes, false);
  return runs;
}

/** Full search results page with snippets, totals and spelling suggestions. */
export async function fullSearch(query: string, offset = 0, limit = 20): Promise<FullSearchResult> {
  const q = query.trim();
  const key = `${q.toLowerCase()}|${offset}|${limit}`;
  return fullSearchCache.getOrLoad(key, async () => {
    const raw = await searchLimiter(() => mwApi({
      action: "query",
      list: "search",
      srsearch: q,
      srnamespace: 0,
      srlimit: limit,
      sroffset: offset || undefined,
      srprop: "size|wordcount|timestamp|snippet",
      srinfo: "totalhits|suggestion",
    }));
    const data = validate(queryResponseSchema, raw, "search");
    const hits = (data.query?.search ?? []).filter((h) => h.ns === 0);
    const meta = await getPagesMeta(hits.map((h) => h.title)).catch(() => [] as PageMeta[]);
    const metaById = new Map(meta.map((m) => [m.pageId, m]));
    const total = data.query?.searchinfo?.totalhits ?? hits.length;
    return {
      query: q,
      total,
      suggestion: data.query?.searchinfo?.suggestion,
      offset,
      nextOffset: offset + hits.length < total && hits.length === limit ? offset + limit : undefined,
      hits: hits.map((h) => {
        const m = metaById.get(h.pageid);
        return {
          pageId: h.pageid,
          title: h.title,
          size: h.size ?? 0,
          wordCount: h.wordcount ?? 0,
          timestamp: h.timestamp,
          snippet: h.snippet ? snippetRuns(h.snippet) : undefined,
          description: m?.description,
          thumbnail: m?.thumbnail,
          disambiguation: m?.disambiguation ?? false,
        };
      }),
    };
  });
}

/** Uniformly random main-namespace articles (Special:Random equivalent). */
export async function getRandomTitles(limit = 30): Promise<string[]> {
  const raw = await mwApi({
    action: "query",
    list: "random",
    rnnamespace: 0,
    rnfilterredir: "nonredirects",
    rnlimit: Math.min(Math.max(limit, 1), 100),
  });
  const data = validate(queryResponseSchema, raw, "random");
  return (data.query?.random ?? []).map((r) => r.title);
}

/** Articles textually similar to `title` (CirrusSearch morelike). */
export async function getMoreLike(title: string, limit = 15): Promise<SearchHit[]> {
  return moreLikeCache.getOrLoad(`${title}|${limit}`, () =>
    searchCandidates(`morelike:"${title.replace(/"/g, "")}"`, { limit }),
  );
}

/**
 * Parsed article HTML via action=parse. `section` limits the output to one
 * section (0 = lead), which lets the reader stream the lead first.
 */
export async function getParsedHtml(title: string, section?: number): Promise<ParsedPageHtml> {
  const normalized = normalizeTitle(title);
  if (!isValidTitle(normalized)) throw new WikipediaError("Invalid article title", "notfound");
  const key = `${normalized}|${section ?? "all"}`;
  return parseCache.getOrLoad(key, async () => {
    const raw = await mwApi(
      {
        action: "parse",
        page: normalized,
        prop: "text|categories|displaytitle|revid",
        redirects: true,
        disableeditsection: true,
        disabletoc: true,
        disablelimitreport: true,
        section,
      },
      { timeoutMs: 15000 },
    );
    const { parse } = validate(parseResponseSchema, raw, "article");
    const displayTitle = parse.displaytitle ? parseHtml(parse.displaytitle).text.trim() || parse.title : parse.title;
    return {
      title: parse.title,
      displayTitle,
      pageId: parse.pageid,
      revId: parse.revid,
      html: parse.text,
      categories: (parse.categories ?? []).map((c) => ({
        name: c.category.replace(/_/g, " "),
        hidden: Boolean(c.hidden),
      })),
    };
  });
}

/** Page summary from the Wikimedia REST API. */
export async function getSummary(title: string): Promise<PageSummary> {
  const normalized = normalizeTitle(title);
  if (!isValidTitle(normalized)) throw new WikipediaError("Invalid article title", "notfound");
  return summaryCache.getOrLoad(normalized, async () => {
    const raw = await fetchJson(`${WIKIPEDIA_REST_URL}/page/summary/${slugFromTitle(normalized)}?redirect=true`);
    const data = validate(summarySchema, raw, "summary");
    return {
      title: data.title,
      description: data.description,
      extract: data.extract,
      type: data.type,
      thumbnail: toThumbnail(data.thumbnail),
      timestamp: data.timestamp,
    };
  });
}

/** Exposed for tests. */
export function __clearWikipediaCaches(): void {
  for (const cache of [metaCache, searchCache, fullSearchCache, parseCache, summaryCache, moreLikeCache]) cache.clear();
}
