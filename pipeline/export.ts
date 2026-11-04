import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { interestScore, isExplorable } from "@/lib/curated/interest";
import { collectionRank, COLLECTIONS, recommendationScore, type CollectionId, type EvidenceCounts } from "@/lib/curated/rank";
import type { CatalogueEntry, EvidenceItem, RecommendedArticle, RecommendedSnapshot, RelatedLink, SnapshotMeta, SourceCoverage } from "@/lib/curated/types";
import { EFFECTIVE_LABEL } from "./classify/run.ts";
import { getState, type Db } from "./db.ts";

/**
 * Publishes the working store as the compact, read-only snapshot the app loads:
 * no usernames, no full comments, every number traceable through provenance.
 */

export const SNAPSHOT_DIR = path.resolve("data/snapshot");

const COLLECTION_SIZE = 300;
const EVIDENCE_PER_ARTICLE = 5;
/** Below two discussions an article appears only if a collection wants it. */
const MIN_DISCUSSIONS_TO_PUBLISH = 2;
const MAX_RELATED = 8;

function writeGz(name: string, data: unknown): number {
  const file = path.join(SNAPSHOT_DIR, name);
  const compressed = zlib.gzipSync(JSON.stringify(data), { level: 9 });
  fs.writeFileSync(file, compressed);
  return compressed.length;
}

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
  monthly_clicks: number | null;
  bytes: number | null;
  disambiguation: number | null;
}

interface EvidenceRow {
  id: string;
  item_url: string;
  discussion_id: string;
  discussion_url: string;
  discussion_title: string | null;
  community: string;
  kind: EvidenceItem["kind"];
  created_at: number;
  excerpt: string;
  reason: string | null;
  classifier: string | null;
  review: string | null;
  confidence: number | null;
  points: number | null;
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
});

export function exportSnapshot(db: Db, log: (message: string) => void, now = Math.floor(Date.now() / 1000)): SnapshotMeta {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const stats = db
    .prepare(`
      SELECT s.page_id, s.title, s.qualifying, s.discussions, s.recommenders, s.months, s.years, s.communities, s.first_at, s.last_at,
        s.recent_12m, s.mentions_other, s.criticism, s.effective, c.monthly_clicks, c.bytes, c.disambiguation
      FROM article_stats s LEFT JOIN catalogue c ON c.page_id = s.page_id
      WHERE s.lang = 'en' AND COALESCE(c.disambiguation, 0) = 0`)
    .all() as unknown as StatsRow[];
  log(`${stats.length} articles with at least one qualifying recommendation`);

  const membership = new Map<CollectionId, Array<[number, number]>>(COLLECTIONS.map((id) => [id, []]));
  for (const row of stats) {
    for (const id of COLLECTIONS) {
      const rank = collectionRank(id, { ...toCounts(row), monthlyClicks: row.monthly_clicks, inCatalogue: row.bytes !== null, bytes: row.bytes }, now);
      if (rank !== null) membership.get(id)!.push([row.page_id, rank]);
    }
  }
  const collections = {} as Record<CollectionId, number[]>;
  const counts = {} as Record<CollectionId, number>;
  for (const id of COLLECTIONS) {
    const ranked = membership.get(id)!.sort((a, b) => b[1] - a[1]);
    counts[id] = ranked.length;
    collections[id] = ranked.slice(0, COLLECTION_SIZE).map(([page]) => page);
  }

  const inCollection = new Set(Object.values(collections).flat());
  const published = stats.filter((row) => row.discussions >= MIN_DISCUSSIONS_TO_PUBLISH || inCollection.has(row.page_id));
  const evidenceQuery = db.prepare(`
    SELECT m.id, m.item_url, m.discussion_id, m.discussion_url, m.discussion_title, m.community, m.kind, m.created_at, m.excerpt, m.reason,
      m.classifier, m.review, m.confidence, m.points
    FROM titles t CROSS JOIN mentions m ON m.lang = t.lang AND m.raw_title = t.raw_title
    WHERE t.lang = 'en' AND t.page_id = ? AND ${EFFECTIVE_LABEL} = 'recommendation'`);
  const otherStats = db.prepare(`
    SELECT DISTINCT m.community FROM titles t CROSS JOIN mentions m ON m.lang = t.lang AND m.raw_title = t.raw_title
    WHERE t.lang = 'en' AND t.page_id = ? AND ${EFFECTIVE_LABEL} = 'recommendation'`);

  const provenance: Array<[number, string, number, string, string]> = [];
  const articles: RecommendedArticle[] = [];
  const discussionsOf = new Map<string, number[]>();
  for (const row of published) {
    const rows = evidenceQuery.all(row.page_id) as unknown as EvidenceRow[];
    const timeline = new Map<number, number>();
    for (const mention of rows) {
      const year = new Date(mention.created_at * 1000).getUTCFullYear();
      timeline.set(year, (timeline.get(year) ?? 0) + 1);
      provenance.push([row.page_id, mention.item_url, mention.created_at, mention.community, mention.review ? "review" : (mention.classifier ?? "")]);
      const members = discussionsOf.get(mention.discussion_id) ?? [];
      if (!members.includes(row.page_id)) members.push(row.page_id);
      discussionsOf.set(mention.discussion_id, members);
    }
    // Words beat scores in evidence: comments that say why, one per discussion, newest first among equals.
    const ordered = [...rows].sort(
      (a, b) => Number(b.kind === "comment") - Number(a.kind === "comment") || (b.confidence ?? 0) - (a.confidence ?? 0) || b.created_at - a.created_at,
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
      discussions: row.discussions,
      recommenders: row.recommenders,
      months: row.months,
      years: row.years,
      communities: (otherStats.all(row.page_id) as Array<{ community: string }>).map((c) => c.community),
      firstAt: row.first_at,
      lastAt: row.last_at,
      recent12m: row.recent_12m,
      otherMentions: row.mentions_other,
      criticism: row.criticism,
      score: Math.round(recommendationScore(toCounts(row)) * 10) / 10,
      timeline: [...timeline].sort((a, b) => a[0] - b[0]),
      evidence: picked.map((mention) => ({
        url: mention.item_url,
        discussionUrl: mention.discussion_url,
        discussionTitle: mention.discussion_title,
        community: mention.community,
        kind: mention.kind,
        at: mention.created_at,
        excerpt: mention.excerpt,
        reason: mention.reason ?? "",
        decidedBy: mention.review ? "review" : (mention.classifier ?? ""),
      })),
    });
  }
  articles.sort((a, b) => b.score - a.score);
  const snapshot: RecommendedSnapshot = { articles, collections };
  log(`recommended.json.gz ${(writeGz("recommended.json.gz", snapshot) / 1e6).toFixed(1)} MB, ${articles.length} articles`);
  log(`provenance.json.gz ${(writeGz("provenance.json.gz", provenance) / 1e6).toFixed(1)} MB, ${provenance.length} records`);

  // Knowledge dataset: every enriched article worth exploring.
  const catalogueRows = db
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
  const catalogue: CatalogueEntry[] = [];
  for (const row of catalogueRows) {
    if (!isExplorable(row.title, row.bytes, row.disambiguation === 1)) continue;
    const sources = row.sources.trim().split(/\s+/);
    catalogue.push({
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
  log(`catalogue.json.gz ${(writeGz("catalogue.json.gz", catalogue) / 1e6).toFixed(1)} MB, ${catalogue.length} articles`);

  // Connections: articles recommended in the same thread, and paths readers really take.
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
  const paths = db.prepare(`
    SELECT e.to_page AS id, c.title, e.clicks FROM edges e JOIN catalogue c ON c.page_id = e.to_page
    WHERE e.from_page = ? AND c.disambiguation = 0 ORDER BY e.clicks DESC LIMIT ?`);
  for (const article of articles) {
    const links: RelatedLink[] = [...(shared.get(article.id) ?? new Map<number, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_RELATED)
      .map(([id, weight]) => ({ id, title: titleOf.get(id)!, kind: "co-recommended" as const, weight }));
    for (const edge of paths.all(article.id, MAX_RELATED) as Array<{ id: number; title: string; clicks: number }>) {
      if (links.length >= MAX_RELATED) break;
      if (!links.some((link) => link.id === edge.id)) links.push({ id: edge.id, title: edge.title, kind: "reader-path", weight: edge.clicks });
    }
    if (links.length) related[article.id] = links;
  }
  log(`related.json.gz ${(writeGz("related.json.gz", related) / 1e6).toFixed(1)} MB, ${Object.keys(related).length} articles`);

  const meta = buildMeta(db, stats.length, provenance.length, catalogue.length, counts, new Date(now * 1000).toISOString());
  fs.writeFileSync(path.join(SNAPSHOT_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

function buildMeta(db: Db, articles: number, qualifying: number, published: number, collections: Record<CollectionId, number>, generatedAt: string): SnapshotMeta {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const bySource = db
    .prepare(`
      SELECT source, count(*) AS mentions, sum(${EFFECTIVE_LABEL} = 'recommendation') AS qualifying,
        date(min(created_at), 'unixepoch') AS oldest, date(max(created_at), 'unixepoch') AS newest
      FROM mentions GROUP BY source`)
    .all() as Array<{ source: string; mentions: number; qualifying: number; oldest: string; newest: string }>;
  const describe: Record<string, Pick<SourceCoverage, "name" | "status" | "detail">> = {
    hackernews: {
      name: "Hacker News",
      status: getState(db, "hn:comment:complete-through") ? "ingested" : "partial",
      detail: "Comments and submissions linking to Wikipedia, through the official Algolia search API.",
    },
    lemmy: { name: "Lemmy (!wikipedia@lemmy.world)", status: getState(db, "lemmy:complete") ? "ingested" : "partial", detail: "Posts in a community for sharing interesting Wikipedia articles, through the public API at its requested crawl delay." },
    tildes: { name: "Tildes", status: "partial", detail: "Public topics found by searching for Wikipedia; comments on other topics are not covered." },
    essays: { name: "Essays and lists", status: "partial", detail: "A short, reviewed list of pages written to recommend Wikipedia articles." },
  };
  const sources: SourceCoverage[] = bySource.map((row) => ({
    id: row.source,
    name: describe[row.source]?.name ?? row.source,
    status: describe[row.source]?.status ?? "partial",
    detail: describe[row.source]?.detail ?? "",
    mentions: row.mentions,
    qualifying: row.qualifying,
    oldest: row.oldest,
    newest: row.newest,
  }));
  sources.push(
    { id: "reddit", name: "Reddit", status: "not-available", detail: "Blocked: the public endpoints return 403, robots.txt disallows all crawlers, and API access needs Reddit's approval.", mentions: 0, qualifying: 0 },
    { id: "lobsters", name: "Lobsters", status: "not-available", detail: "Not read: its robots.txt disallows general crawlers and asks not to be used as AI input.", mentions: 0, qualifying: 0 },
  );
  const deciders = Object.fromEntries(
    (db.prepare("SELECT COALESCE(classifier, 'unclassified') AS c, count(*) AS n FROM mentions GROUP BY c").all() as Array<{ c: string; n: number }>).map((row) => [row.c, row.n]),
  );
  const labels = Object.fromEntries(
    (db.prepare(`SELECT COALESCE(${EFFECTIVE_LABEL}, 'unclassified') AS l, count(*) AS n FROM mentions GROUP BY l`).all() as Array<{ l: string; n: number }>).map((row) => [row.l, row.n]),
  );
  const reviewed = (kind: string, label: string) => {
    const rejected = label === "rejected";
    const where = `review IS NOT NULL AND kind = '${kind}' AND ${rejected ? "label <> 'recommendation'" : "label = 'recommendation'"}`;
    return { checked: count(`SELECT count(*) AS n FROM mentions WHERE ${where}`), recommendation: count(`SELECT count(*) AS n FROM mentions WHERE ${where} AND review = 'recommendation'`) };
  };
  const comments = reviewed("comment", "counted");
  const submissions = reviewed("submission", "counted");
  const rejected = reviewed("comment", "rejected");
  return {
    generatedAt,
    sources,
    classification: {
      deciders,
      labels,
      reviewed: {
        sample: count("SELECT count(*) AS n FROM mentions WHERE review IS NOT NULL"),
        comments: { checked: comments.checked, confirmed: comments.recommendation },
        submissions: { checked: submissions.checked, confirmed: submissions.recommendation },
        rejectedComments: { checked: rejected.checked, missed: rejected.recommendation },
      },
    },
    human: {
      articles,
      qualifying: count(`SELECT count(*) AS n FROM mentions WHERE ${EFFECTIVE_LABEL} = 'recommendation'`),
      discussions: count(`SELECT count(DISTINCT discussion_id) AS n FROM mentions WHERE ${EFFECTIVE_LABEL} = 'recommendation'`),
    },
    catalogue: {
      articlesScanned: Number(getState(db, "catalogue:articles") ?? 0),
      pagesDumpDate: getState(db, "catalogue:pages-dump"),
      clickstreamMonth: getState(db, "catalogue:clickstream-month"),
      withClickData: count("SELECT count(*) AS n FROM catalogue WHERE monthly_clicks IS NOT NULL"),
      enriched: count("SELECT count(*) AS n FROM catalogue WHERE last_revision IS NOT NULL AND last_revision <> ''"),
      published,
    },
    collections,
  };
}
