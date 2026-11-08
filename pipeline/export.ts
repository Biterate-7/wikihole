import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { interestScore, isExplorable } from "@/lib/curated/interest";
import { collectionRank, COLLECTIONS, recommendationScore, type CollectionId, type EvidenceCounts } from "@/lib/curated/rank";
import type { CatalogueEntry, CatalogueMeta, EvidenceItem, HumanMeta, RecommendedArticle, RecommendedSnapshot, RelatedLink, SourceCoverage } from "@/lib/curated/types";
import { getState, type Db } from "./db.ts";
import { evaluate } from "./classify/evaluate.ts";
import { onePerItem } from "./stats.ts";

/**
 * Publishes each working store as its own compact, read-only dataset, with its
 * own quality metrics: no usernames, no full comments, every number traceable.
 * They are joined by page id only when the app displays them.
 */

export const SNAPSHOT_DIR = path.resolve(process.env.WIKIHOLE_SNAPSHOT_OUT ?? "data/snapshot");
export const HUMAN_DIR = path.join(SNAPSHOT_DIR, "human");
export const CATALOGUE_DIR = path.join(SNAPSHOT_DIR, "catalogue");

const COLLECTION_SIZE = 300;
const EVIDENCE_PER_ARTICLE = 5;
const MAX_RELATED = 8;
const QUALIFIES = "m.final_label = 'recommendation'";

function writeGz(dir: string, name: string, data: unknown): number {
  fs.mkdirSync(dir, { recursive: true });
  const compressed = zlib.gzipSync(JSON.stringify(data), { level: 9 });
  fs.writeFileSync(path.join(dir, name), compressed);
  return compressed.length;
}

/* ------------------------------------------------------------------------ */
/* Human dataset                                                             */
/* ------------------------------------------------------------------------ */

interface StatsRow {
  page_id: number;
  title: string;
  qualifying: number;
  discussions: number;
  recommenders: number;
  months: number;
  years: number;
  communities: number;
  first_at: number;
  last_at: number;
  recent_12m: number;
  mentions_other: number;
  criticism: number;
  effective: number;
  in_words: number;
}

interface EvidenceRow {
  item_url: string;
  discussion_id: string;
  discussion_url: string;
  discussion_title: string | null;
  community: string;
  kind: EvidenceItem["kind"];
  created_at: number;
  excerpt: string;
  reason: string | null;
  llm_reason: string | null;
  decided_by: string | null;
  final_confidence: number | null;
}

const toCounts = (row: StatsRow): EvidenceCounts => ({
  qualifying: row.qualifying,
  discussions: row.discussions,
  recommenders: row.recommenders,
  months: row.months,
  years: row.years,
  communities: row.communities,
  firstAt: row.first_at,
  lastAt: row.last_at,
  recent12m: row.recent_12m,
  effective: row.effective,
  inWords: row.in_words,
});

export type PageFacts = { monthly_clicks: number | null; bytes: number; disambiguation: number };

/** `factsFor` is the only thing the human dataset reads from the catalogue: facts about a page id. */
export function exportHuman(db: Db, factsFor: (pageId: number) => PageFacts | undefined, log: (message: string) => void, now = Math.floor(Date.now() / 1000)): HumanMeta {
  const stats = (db
    .prepare(`
      SELECT page_id, title, qualifying, discussions, recommenders, months, years, communities, first_at, last_at,
        recent_12m, mentions_other, criticism, effective, in_words
      FROM article_stats WHERE lang = 'en'`)
    .all() as unknown as StatsRow[]).filter((row) => factsFor(row.page_id)?.disambiguation !== 1);
  log(`${stats.length} articles with at least one qualifying recommendation`);

  const membership = new Map<CollectionId, Array<[number, number]>>(COLLECTIONS.map((id) => [id, []]));
  for (const row of stats) {
    const facts = factsFor(row.page_id);
    for (const id of COLLECTIONS) {
      const rank = collectionRank(id, { ...toCounts(row), mentionsOther: row.mentions_other, monthlyClicks: facts?.monthly_clicks ?? null, inCatalogue: facts !== undefined, bytes: facts?.bytes ?? null }, now);
      if (rank !== null) membership.get(id)!.push([row.page_id, rank]);
    }
  }
  const collections = {} as Record<CollectionId, number[]>;
  const sizes = {} as Record<CollectionId, number>;
  for (const id of COLLECTIONS) {
    const ranked = membership.get(id)!.sort((a, b) => b[1] - a[1]);
    sizes[id] = ranked.length;
    collections[id] = ranked.slice(0, COLLECTION_SIZE).map(([page]) => page);
  }

  const published = stats;
  const evidenceQuery = db.prepare(`
    SELECT m.item_url, m.discussion_id, m.discussion_url, m.discussion_title, m.community, m.kind, m.created_at, m.excerpt, m.reason, m.llm_reason, m.decided_by, m.final_confidence
    FROM titles t CROSS JOIN mentions m ON m.lang = t.lang AND m.raw_title = t.raw_title
    WHERE t.lang = 'en' AND t.page_id = ? AND ${QUALIFIES}`);

  const provenance: Array<[number, string, number, string, string]> = [];
  const articles: RecommendedArticle[] = [];
  const discussionsOf = new Map<string, number[]>();
  for (const row of published) {
    const rows = onePerItem(evidenceQuery.all(row.page_id) as unknown as EvidenceRow[]);
    const timeline = new Map<number, number>();
    for (const mention of rows) {
      const year = new Date(mention.created_at * 1000).getUTCFullYear();
      timeline.set(year, (timeline.get(year) ?? 0) + 1);
      provenance.push([row.page_id, mention.item_url, mention.created_at, mention.community, mention.decided_by ?? ""]);
      const members = discussionsOf.get(mention.discussion_id) ?? [];
      if (!members.includes(row.page_id)) members.push(row.page_id);
      discussionsOf.set(mention.discussion_id, members);
    }
    // Words beat scores in evidence: comments that say why, one per discussion, surest first, then newest.
    const ordered = [...rows].sort(
      (a, b) => Number(b.kind !== "submission") - Number(a.kind !== "submission") || (b.final_confidence ?? 0) - (a.final_confidence ?? 0) || b.created_at - a.created_at,
    );
    const picked: EvidenceRow[] = [];
    const seenDiscussions = new Set<string>();
    for (const mention of ordered) {
      if (picked.length >= EVIDENCE_PER_ARTICLE) break;
      if (seenDiscussions.has(mention.discussion_id)) continue;
      seenDiscussions.add(mention.discussion_id);
      picked.push(mention);
    }
    articles.push({
      id: row.page_id,
      title: row.title,
      qualifying: row.qualifying,
      inWords: row.in_words,
      discussions: row.discussions,
      recommenders: row.recommenders,
      months: row.months,
      years: row.years,
      communities: [...new Set(rows.map((mention) => mention.community))],
      firstAt: row.first_at,
      lastAt: row.last_at,
      recent12m: row.recent_12m,
      otherMentions: row.mentions_other,
      criticism: row.criticism,
      score: Math.round(recommendationScore(toCounts(row), row.mentions_other) * 10) / 10,
      timeline: [...timeline].sort((a, b) => a[0] - b[0]),
      evidence: picked.map((mention) => ({
        url: mention.item_url,
        discussionUrl: mention.discussion_url,
        discussionTitle: mention.discussion_title,
        community: mention.community,
        kind: mention.kind,
        at: mention.created_at,
        excerpt: mention.excerpt,
        reason: mention.llm_reason || mention.reason || "",
        decidedBy: mention.decided_by ?? "",
      })),
    });
  }
  articles.sort((a, b) => b.score - a.score);
  const snapshot: RecommendedSnapshot = { articles, collections };
  log(`human/recommended.json.gz ${(writeGz(HUMAN_DIR, "recommended.json.gz", snapshot) / 1e6).toFixed(1)} MB, ${articles.length} articles`);
  log(`human/provenance.json.gz ${(writeGz(HUMAN_DIR, "provenance.json.gz", provenance) / 1e6).toFixed(1)} MB, ${provenance.length} records`);

  // Articles recommended in the same threads.
  const titleOf = new Map(articles.map((a) => [a.id, a.title]));
  const shared = new Map<number, Map<number, number>>();
  for (const members of discussionsOf.values()) {
    if (members.length < 2 || members.length > 40) continue;
    for (const a of members) {
      const neighbours = shared.get(a) ?? new Map<number, number>();
      for (const b of members) if (a !== b) neighbours.set(b, (neighbours.get(b) ?? 0) + 1);
      shared.set(a, neighbours);
    }
  }
  const related: Record<number, RelatedLink[]> = {};
  for (const [id, neighbours] of shared) {
    related[id] = [...neighbours]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_RELATED)
      .map(([other, weight]) => ({ id: other, title: titleOf.get(other)!, kind: "co-recommended" as const, weight }));
  }
  log(`human/related.json.gz ${(writeGz(HUMAN_DIR, "related.json.gz", related) / 1e6).toFixed(1)} MB, ${Object.keys(related).length} articles`);

  const meta = buildHumanMeta(db, stats.length, articles.length, sizes, new Date(now * 1000).toISOString());
  fs.writeFileSync(path.join(HUMAN_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

function buildHumanMeta(db: Db, articles: number, published: number, collections: Record<CollectionId, number>, generatedAt: string): HumanMeta {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const bySource = db
    .prepare(`
      SELECT source, count(*) AS mentions, sum(final_label = 'recommendation') AS qualifying, sum(final_label = 'needs-review') AS undecided,
        date(min(created_at), 'unixepoch') AS oldest, date(max(created_at), 'unixepoch') AS newest
      FROM mentions GROUP BY source`)
    .all() as Array<{ source: string; mentions: number; qualifying: number; undecided: number; oldest: string; newest: string }>;
  const describe: Record<string, Pick<SourceCoverage, "name" | "status" | "detail">> = {
    lemmy: {
      name: "Lemmy (!wikipedia@lemmy.world)",
      status: getState(db, "lemmy:complete") ? "complete" : "partial",
      detail: "Posts in a community for sharing interesting Wikipedia articles, at its requested crawl delay. Comments are not read.",
    },
    tildes: { name: "Tildes", status: "partial", detail: "Public topics its search returns for 'wikipedia'. Comments on other topics are not covered." },
    essays: { name: "Essays and lists", status: "partial", detail: "A short, reviewed list of pages written to recommend Wikipedia articles, not a survey of the web." },
  };
  const sources: SourceCoverage[] = bySource.map((row) => ({
    id: row.source,
    name: describe[row.source]?.name ?? row.source,
    status: describe[row.source]?.status ?? "partial",
    detail: describe[row.source]?.detail ?? "",
    mentions: row.mentions,
    qualifying: row.qualifying,
    undecided: row.undecided,
    oldest: row.oldest,
    newest: row.newest,
  }));
  sources.push(
    { id: "reddit", name: "Reddit", status: "not-available", detail: "Blocked: public endpoints return 403, robots.txt disallows all crawlers, and API access needs Reddit's approval.", mentions: 0, qualifying: 0, undecided: 0 },
    { id: "lobsters", name: "Lobsters", status: "not-available", detail: "Not read: its robots.txt disallows general crawlers and asks not to be used as AI input.", mentions: 0, qualifying: 0, undecided: 0 },
  );
  const group = (sql: string) => Object.fromEntries((db.prepare(sql).all() as Array<{ k: string; n: number }>).map((row) => [row.k, row.n]));
  return {
    generatedAt,
    sources,
    classification: {
      labels: group("SELECT COALESCE(final_label, 'unclassified') AS k, count(*) AS n FROM mentions GROUP BY k"),
      deciders: group("SELECT COALESCE(decided_by, 'unclassified') AS k, count(*) AS n FROM mentions WHERE final_label = 'recommendation' GROUP BY k"),
      evaluation: evaluate(db),
    },
    resolution: group("SELECT status AS k, count(*) AS n FROM titles GROUP BY k"),
    totals: {
      mentions: count("SELECT count(*) AS n FROM mentions"),
      articles,
      published,
      qualifying: count("SELECT count(*) AS n FROM mentions WHERE final_label = 'recommendation'"),
      inWords: count("SELECT count(*) AS n FROM mentions WHERE final_label = 'recommendation' AND kind <> 'submission'"),
      discussions: count("SELECT count(DISTINCT discussion_id) AS n FROM mentions WHERE final_label = 'recommendation'"),
      nonEnglishMentions: count("SELECT count(*) AS n FROM mentions WHERE lang <> 'en'"),
    },
    collections,
  };
}

/* ------------------------------------------------------------------------ */
/* Knowledge dataset                                                         */
/* ------------------------------------------------------------------------ */

export function exportCatalogue(db: Db, log: (message: string) => void, now = Math.floor(Date.now() / 1000)): CatalogueMeta {
  const rows = db
    .prepare(`
      SELECT page_id, title, description, qid, bytes, monthly_clicks, external_share, inbound_pages, incoming_links, assessment, topics, categories,
        instance_of, last_revision, sources, disambiguation
      FROM catalogue WHERE sources IS NOT NULL`)
    .all() as unknown as Array<{
    page_id: number;
    title: string;
    description: string | null;
    qid: string | null;
    bytes: number;
    monthly_clicks: number | null;
    external_share: number | null;
    inbound_pages: number | null;
    incoming_links: number | null;
    assessment: string | null;
    topics: string | null;
    categories: string | null;
    instance_of: string | null;
    last_revision: string | null;
    sources: string;
    disambiguation: number;
  }>;
  const parseList = (value: string | null) => (value ? (JSON.parse(value) as string[]) : undefined);
  const entries: CatalogueEntry[] = [];
  for (const row of rows) {
    if (!isExplorable(row.title, row.bytes, row.disambiguation === 1)) continue;
    // Why it was enriched at another dataset's request is not a fact about the article.
    const sources = row.sources.trim().split(/\s+/).filter((source) => source !== "target");
    entries.push({
      id: row.page_id,
      title: row.title,
      ...(row.description ? { description: row.description } : {}),
      ...(row.qid ? { qid: row.qid } : {}),
      bytes: row.bytes,
      ...(row.monthly_clicks !== null ? { monthlyClicks: row.monthly_clicks } : {}),
      ...(row.external_share !== null ? { externalShare: Math.round(row.external_share * 100) / 100 } : {}),
      ...(row.inbound_pages !== null ? { inboundPages: row.inbound_pages } : {}),
      ...(row.incoming_links !== null ? { incomingLinks: row.incoming_links } : {}),
      ...(row.assessment ? { assessment: row.assessment } : {}),
      ...(parseList(row.topics)?.length ? { topics: parseList(row.topics) } : {}),
      ...(parseList(row.categories)?.length ? { categories: parseList(row.categories) } : {}),
      ...(parseList(row.instance_of)?.length ? { instanceOf: parseList(row.instance_of) } : {}),
      ...(row.last_revision ? { lastRevision: row.last_revision } : {}),
      sources,
      interest: interestScore({ bytes: row.bytes, assessment: row.assessment, sources, monthlyClicks: row.monthly_clicks, inboundPages: row.inbound_pages, externalShare: row.external_share }),
    });
  }
  log(`catalogue/entries.json.gz ${(writeGz(CATALOGUE_DIR, "entries.json.gz", entries) / 1e6).toFixed(1)} MB, ${entries.length} articles`);

  // Paths readers really take, for pages that were asked about.
  const paths: Record<number, RelatedLink[]> = {};
  const edgeRows = db
    .prepare(`
      SELECT e.from_page, e.to_page, c.title, e.clicks FROM edges e JOIN catalogue c ON c.page_id = e.to_page
      WHERE c.disambiguation = 0 ORDER BY e.from_page, e.clicks DESC`)
    .all() as Array<{ from_page: number; to_page: number; title: string; clicks: number }>;
  for (const edge of edgeRows) {
    const list = (paths[edge.from_page] ??= []);
    if (list.length < MAX_RELATED) list.push({ id: edge.to_page, title: edge.title, kind: "reader-path", weight: edge.clicks });
  }
  log(`catalogue/paths.json.gz ${(writeGz(CATALOGUE_DIR, "paths.json.gz", paths) / 1e6).toFixed(1)} MB, ${Object.keys(paths).length} articles`);

  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const scanned = count("SELECT count(*) AS n FROM catalogue");
  const meta: CatalogueMeta = {
    generatedAt: new Date(now * 1000).toISOString(),
    scan: {
      status: Number(getState(db, "catalogue:articles") ?? 0) > 0 ? "complete" : "not-run",
      articles: scanned,
      rowsRead: Number(getState(db, "catalogue:pages-scanned") ?? 0),
      pagesDumpDate: getState(db, "catalogue:pages-dump"),
      withWikidata: count("SELECT count(*) AS n FROM catalogue WHERE qid IS NOT NULL"),
      withDescription: count("SELECT count(*) AS n FROM catalogue WHERE description IS NOT NULL"),
      disambiguation: count("SELECT count(*) AS n FROM catalogue WHERE disambiguation = 1"),
      clickstreamMonth: getState(db, "catalogue:clickstream-month"),
      clickstreamRows: Number(getState(db, "catalogue:clickstream-rows") ?? 0),
      withClickData: count("SELECT count(*) AS n FROM catalogue WHERE monthly_clicks IS NOT NULL"),
    },
    enrichment: {
      selected: count("SELECT count(*) AS n FROM catalogue WHERE sources IS NOT NULL"),
      enriched: count("SELECT count(*) AS n FROM catalogue WHERE last_revision IS NOT NULL AND last_revision <> ''"),
      noDocument: count("SELECT count(*) AS n FROM catalogue WHERE last_revision = ''"),
      pending: count("SELECT count(*) AS n FROM catalogue WHERE sources IS NOT NULL AND last_revision IS NULL"),
      withTopics: count("SELECT count(*) AS n FROM catalogue WHERE topics IS NOT NULL AND topics <> '[]'"),
      withAssessment: count("SELECT count(*) AS n FROM catalogue WHERE assessment IS NOT NULL"),
      withInstanceOf: count("SELECT count(*) AS n FROM catalogue WHERE instance_of IS NOT NULL AND instance_of <> '[]'"),
      featured: count("SELECT count(*) AS n FROM catalogue WHERE sources LIKE '%featured %'"),
      good: count("SELECT count(*) AS n FROM catalogue WHERE sources LIKE '%good %'"),
      unusual: count("SELECT count(*) AS n FROM catalogue WHERE sources LIKE '%unusual %'"),
      sampled: count("SELECT count(*) AS n FROM catalogue WHERE sources LIKE '%sample %'"),
      requestedByOtherDatasets: count("SELECT count(*) AS n FROM targets"),
    },
    published: entries.length,
    notScanned: ["The full internal link graph (pagelinks, 7 GB)", "The full category graph (categorylinks, 2.5 GB)", "Wikidata beyond the item id, except 'instance of' for requested pages"],
  };
  fs.writeFileSync(path.join(CATALOGUE_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}
