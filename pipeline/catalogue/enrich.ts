import { z } from "zod";
import { getState, setState, transaction, type Db } from "../db.ts";
import { fetchJson } from "../http.ts";

/**
 * Deep metadata for a selected part of the catalogue, from the Action API:
 * incoming links, ORES article topics, categories, assessment class and last
 * revision. The dumps cover every article; this step costs one request per 50
 * articles, so it covers pages another dataset asked about (`targets`), Wikipedia's own showcase
 * lists, and a broad sample of substantial articles. It resumes where it stopped.
 */

const API = "https://en.wikipedia.org/w/api.php";
const GAP_MS = 340;

const responseSchema = z.object({
  continue: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  query: z
    .object({
      pages: z
        .array(
          z.object({
            pageid: z.number().optional(),
            title: z.string().optional(),
            pageassessments: z.record(z.string(), z.object({ class: z.string().optional() })).optional(),
            cirrusdoc: z
              .array(
                z.object({
                  source: z
                    .object({
                      incoming_links: z.number().optional(),
                      weighted_tags: z.array(z.string()).optional(),
                      category: z.array(z.string()).optional(),
                      timestamp: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          }),
        )
        .optional(),
      categorymembers: z.array(z.object({ pageid: z.number(), ns: z.number(), title: z.string() })).optional(),
    })
    .optional(),
});

const MAINTENANCE_CATEGORY =
  /^(All |Articles? |CS1|Webarchive|Wikipedia |Use |Pages |Short description|Harv and Sfn|Good articles|Featured articles|Commons |Coordinates|Official website|AC with|Wikidata|Engvar|EngvarB|Vague|Interlanguage|Biography with|Lists? of|Webarchive)/i;

const CLASS_RANK: Record<string, number> = { fa: 8, fl: 7, a: 7, ga: 6, b: 5, c: 4, list: 3, start: 2, stub: 1 };

export function bestClass(assessments: Record<string, { class?: string }> | undefined): string | null {
  let best: string | null = null;
  for (const { class: value } of Object.values(assessments ?? {})) {
    const key = value?.trim().toLowerCase() ?? "";
    if (CLASS_RANK[key] && (!best || CLASS_RANK[key] > CLASS_RANK[best.toLowerCase()])) best = value!.trim();
  }
  return best;
}

export function articleTopics(tags: string[] | undefined): string[] {
  const prefix = "classification.prediction.articletopic/";
  return (tags ?? [])
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length).split("|"))
    .sort((a, b) => Number(b[1] ?? 0) - Number(a[1] ?? 0))
    .map(([topic]) => topic)
    .slice(0, 4);
}

async function addFromCategory(db: Db, category: string, source: string, log: (message: string) => void): Promise<number> {
  const mark = db.prepare("UPDATE catalogue SET sources = COALESCE(sources, '') || ? WHERE page_id = ? AND (sources IS NULL OR sources NOT LIKE ?)");
  let added = 0;
  let cont: Record<string, string | number> = {};
  for (;;) {
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", list: "categorymembers", cmtitle: `Category:${category}`, cmnamespace: "0", cmlimit: "500" });
    for (const [key, value] of Object.entries(cont)) params.set(key, String(value));
    const data = responseSchema.parse(await fetchJson(`${API}?${params}`, { gapMs: GAP_MS }));
    const members = data.query?.categorymembers ?? [];
    transaction(db, () => {
      for (const member of members) added += Number(mark.run(`${source} `, member.pageid, `%${source} %`).changes);
    });
    if (!data.continue) break;
    cont = data.continue;
  }
  log(`${source}: ${added} articles from Category:${category}`);
  return added;
}

/** Links on Wikipedia:Unusual articles, the encyclopedia's own list of its oddest entries. */
async function addUnusual(db: Db, log: (message: string) => void): Promise<number> {
  const mark = db.prepare("UPDATE catalogue SET sources = COALESCE(sources, '') || 'unusual ' WHERE title = ? AND (sources IS NULL OR sources NOT LIKE '%unusual %')");
  let added = 0;
  let cont: Record<string, string | number> = {};
  for (;;) {
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", titles: "Wikipedia:Unusual articles", generator: "links", gplnamespace: "0", gpllimit: "max" });
    for (const [key, value] of Object.entries(cont)) params.set(key, String(value));
    const data = responseSchema.parse(await fetchJson(`${API}?${params}`, { gapMs: GAP_MS }));
    transaction(db, () => {
      for (const page of data.query?.pages ?? []) if (page.title) added += Number(mark.run(page.title).changes);
    });
    if (!data.continue) break;
    cont = data.continue;
  }
  log(`unusual: ${added} articles`);
  return added;
}

const SAMPLE_SIZE = 40000;

/**
 * Chooses what to enrich. The sample is drawn by page id hash so it is stable
 * across runs, from articles long enough to be worth reading.
 */
export async function selectForEnrichment(db: Db, log: (message: string) => void): Promise<number> {
  if (getState(db, "enrich:selected") !== "1") {
    await addFromCategory(db, "Featured articles", "featured", log);
    await addFromCategory(db, "Good articles", "good", log);
    await addUnusual(db, log);
    const sampled = db
      .prepare(`
        UPDATE catalogue SET sources = COALESCE(sources, '') || 'sample ' WHERE page_id IN (
          SELECT page_id FROM catalogue
          WHERE disambiguation = 0 AND bytes >= 12000 AND monthly_clicks BETWEEN 100 AND 300000
            AND title NOT LIKE 'List of %' AND title NOT LIKE 'Lists of %' AND title NOT LIKE '% in %'
            AND title NOT GLOB '[0-9]*'
          ORDER BY (page_id * 2654435761) % 4294967296 LIMIT ?
        )`)
      .run(SAMPLE_SIZE);
    log(`sample: ${sampled.changes} articles`);
    setState(db, "enrich:selected", "1");
  }
  db.exec(`
    UPDATE catalogue SET sources = COALESCE(sources, '') || 'target '
    WHERE page_id IN (SELECT page_id FROM targets) AND (sources IS NULL OR sources NOT LIKE '%target %')`);
  return (db.prepare("SELECT count(*) AS n FROM catalogue WHERE sources IS NOT NULL").get() as { n: number }).n;
}

export async function enrichCatalogue(db: Db, options: { limit?: number; log: (message: string) => void }): Promise<number> {
  const pending = db.prepare("SELECT page_id FROM catalogue WHERE sources IS NOT NULL AND last_revision IS NULL AND page_id > ? ORDER BY page_id LIMIT 50");
  const update = db.prepare("UPDATE catalogue SET incoming_links = ?, topics = ?, categories = ?, last_revision = ?, assessment = COALESCE(?, assessment) WHERE page_id = ?");
  const missing = db.prepare("UPDATE catalogue SET last_revision = '' WHERE page_id = ?");
  let done = 0;
  let after = 0;
  while (options.limit === undefined || done < options.limit) {
    const rows = pending.all(after) as Array<{ page_id: number }>;
    if (rows.length === 0) break;
    after = rows.at(-1)!.page_id;
    const pages = new Map<number, NonNullable<NonNullable<z.infer<typeof responseSchema>["query"]>["pages"]>[number]>();
    let cont: Record<string, string | number> = {};
    for (let round = 0; round < 8; round++) {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        pageids: rows.map((row) => row.page_id).join("|"),
        prop: "cirrusdoc|pageassessments",
        cdincludes: "incoming_links|weighted_tags|category|timestamp",
        palimit: "max",
      });
      for (const [key, value] of Object.entries(cont)) params.set(key, String(value));
      const data = responseSchema.parse(await fetchJson(`${API}?${params}`, { gapMs: GAP_MS }));
      for (const page of data.query?.pages ?? []) {
        if (page.pageid === undefined) continue;
        const known = pages.get(page.pageid);
        pages.set(page.pageid, {
          ...page,
          cirrusdoc: known?.cirrusdoc?.length ? known.cirrusdoc : page.cirrusdoc,
          pageassessments: { ...known?.pageassessments, ...page.pageassessments },
        });
      }
      if (!data.continue) break;
      cont = data.continue;
    }
    transaction(db, () => {
      for (const { page_id } of rows) {
        const page = pages.get(page_id);
        const source = page?.cirrusdoc?.[0]?.source;
        if (!source) {
          missing.run(page_id);
          continue;
        }
        update.run(
          source.incoming_links ?? null,
          JSON.stringify(articleTopics(source.weighted_tags)),
          JSON.stringify((source.category ?? []).filter((c) => !MAINTENANCE_CATEGORY.test(c)).slice(0, 8)),
          source.timestamp ?? "",
          bestClass(page?.pageassessments),
          page_id,
        );
      }
    });
    done += rows.length;
    if (done % 5000 < 50) options.log(`enriched ${done}`);
  }
  return done;
}

/** Wikidata "instance of" labels for the given articles. */
export async function enrichWikidata(db: Db, options: { limit?: number; log: (message: string) => void }): Promise<number> {
  const pending = db.prepare(`
    SELECT page_id, qid FROM catalogue
    WHERE qid IS NOT NULL AND instance_of IS NULL AND sources LIKE '%target %' AND page_id > ? ORDER BY page_id LIMIT 50`);
  const update = db.prepare("UPDATE catalogue SET instance_of = ? WHERE page_id = ?");
  const entitySchema = z.object({
    entities: z.record(
      z.string(),
      z.object({
        labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
        // Only "instance of" is read. Other properties hold strings, dates and more.
        claims: z
          .object({ P31: z.array(z.object({ mainsnak: z.object({ datavalue: z.object({ value: z.object({ id: z.string().optional() }).loose() }).optional() }) })).optional() })
          .loose()
          .optional(),
      }),
    ),
  });
  const labelCache = new Map<string, string>();
  const get = async (ids: string[], props: string) => {
    const params = new URLSearchParams({ action: "wbgetentities", format: "json", ids: ids.join("|"), props, languages: "en" });
    return entitySchema.parse(await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, { gapMs: GAP_MS })).entities;
  };
  let done = 0;
  let after = 0;
  while (options.limit === undefined || done < options.limit) {
    const rows = pending.all(after) as Array<{ page_id: number; qid: string }>;
    if (rows.length === 0) break;
    after = rows.at(-1)!.page_id;
    const entities = await get(rows.map((row) => row.qid), "claims");
    const types = new Map<string, string[]>();
    for (const row of rows) {
      const claims = entities[row.qid]?.claims?.P31 ?? [];
      types.set(row.qid, claims.flatMap((claim) => (claim.mainsnak.datavalue?.value.id ? [claim.mainsnak.datavalue.value.id] : [])).slice(0, 4));
    }
    const unknown = [...new Set([...types.values()].flat())].filter((id) => !labelCache.has(id));
    for (let i = 0; i < unknown.length; i += 50) {
      const labels = await get(unknown.slice(i, i + 50), "labels");
      for (const [id, entity] of Object.entries(labels)) labelCache.set(id, entity.labels?.en?.value ?? id);
    }
    transaction(db, () => {
      for (const row of rows) update.run(JSON.stringify((types.get(row.qid) ?? []).map((id) => labelCache.get(id) ?? id)), row.page_id);
    });
    done += rows.length;
    if (done % 5000 < 50) options.log(`wikidata ${done}`);
  }
  setState(db, "enrich:wikidata-done", done);
  return done;
}
