import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { z } from "zod";
import { collectionRank, COLLECTIONS, countEvidence, type QualifyingMention } from "@/lib/curated/rank";
import type { RecommendedSnapshot, CatalogueEntry } from "@/lib/curated/types";
import type { Db } from "./db.ts";
import { SNAPSHOT_DIR, type PageFacts } from "./export.ts";
import { fetchJson } from "./http.ts";
import { onePerItem } from "./stats.ts";

/**
 * Checks the published snapshot against the working store and against live
 * Wikipedia. Each check samples at random and reports failures by name, so a
 * problem can be traced. Writes data/snapshot/verification.json.
 */

function read<T>(name: string): T {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(SNAPSHOT_DIR, name))).toString("utf8")) as T;
}

function sample<T>(items: T[], size: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, size);
}

export interface CheckResult {
  name: string;
  checked: number;
  failed: number;
  examples: string[];
}

function check<T>(name: string, items: T[], test: (item: T) => string | null): CheckResult {
  const failures = items.flatMap((item) => {
    const problem = test(item);
    return problem ? [problem] : [];
  });
  return { name, checked: items.length, failed: failures.length, examples: failures.slice(0, 5) };
}

const pagesSchema = z.object({
  query: z.object({ pages: z.array(z.object({ pageid: z.number().optional(), ns: z.number().optional(), title: z.string().optional(), missing: z.boolean().optional() })) }).optional(),
});

export async function verifySnapshot(db: Db, factsFor: (pageId: number) => PageFacts | undefined, log: (message: string) => void, sizes = { live: 300, recount: 500 }): Promise<CheckResult[]> {
  const snapshot = read<RecommendedSnapshot>("human/recommended.json.gz");
  const catalogue = read<CatalogueEntry[]>("catalogue/entries.json.gz");
  const provenance = read<Array<[number, string, number, string, string]>>("human/provenance.json.gz");
  const results: CheckResult[] = [];
  const now = Math.floor(Date.now() / 1000);

  // Deduplication.
  const seenIds = new Set<number>();
  const seenTitles = new Set<string>();
  results.push(
    check("articles are unique by page id and by title", snapshot.articles, (article) => {
      const problem = seenIds.has(article.id) || seenTitles.has(article.title) ? `${article.id} ${article.title}` : null;
      seenIds.add(article.id);
      seenTitles.add(article.title);
      return problem;
    }),
  );
  const links = new Set<string>();
  results.push(
    check("no source link is counted twice for one article", provenance, ([page, url]) => {
      const key = `${page}|${url}`;
      const problem = links.has(key) ? key : null;
      links.add(key);
      return problem;
    }),
  );
  const catalogueIds = new Set<number>();
  results.push(
    check("catalogue rows are unique", catalogue, (entry) => {
      const problem = catalogueIds.has(entry.id) ? String(entry.id) : null;
      catalogueIds.add(entry.id);
      return problem;
    }),
  );

  // Traceability: recompute published numbers from the stored mentions.
  const mentionsOf = db.prepare(`
    SELECT m.item_url, m.discussion_id, m.community, m.author_hash, m.created_at, m.kind
    FROM titles t CROSS JOIN mentions m ON m.lang = t.lang AND m.raw_title = t.raw_title
    WHERE t.lang = 'en' AND t.page_id = ? AND m.final_label = 'recommendation'`);
  const byPage = new Map<number, number>();
  for (const [page] of provenance) byPage.set(page, (byPage.get(page) ?? 0) + 1);
  results.push(
    check("published counts equal a recount of stored mentions", sample(snapshot.articles, sizes.recount), (article) => {
      const rows = onePerItem(mentionsOf.all(article.id) as Array<{ item_url: string; discussion_id: string; community: string; author_hash: string | null; created_at: number; kind: string }>);
      const counts = countEvidence(
        rows.map((row): QualifyingMention => ({ discussionId: row.discussion_id, community: row.community, authorHash: row.author_hash, at: row.created_at, inWords: row.kind !== "submission" })),
        now,
      );
      if (counts.qualifying !== article.qualifying || counts.discussions !== article.discussions || counts.recommenders !== article.recommenders || counts.months !== article.months) {
        return `${article.title}: published ${article.qualifying}/${article.discussions}/${article.recommenders}/${article.months}, recount ${counts.qualifying}/${counts.discussions}/${counts.recommenders}/${counts.months}`;
      }
      return byPage.get(article.id) === article.qualifying ? null : `${article.title}: ${byPage.get(article.id)} provenance records for ${article.qualifying}`;
    }),
  );

  // Collections hold only what their evidence gate allows, in order.
  const byId = new Map(snapshot.articles.map((article) => [article.id, article]));
  const statsRow = db.prepare("SELECT effective FROM article_stats WHERE lang = 'en' AND page_id = ?");
  for (const id of COLLECTIONS) {
    let previous = Infinity;
    results.push(
      check(`collection "${id}" meets its gate, in order`, snapshot.collections[id], (page) => {
        const article = byId.get(page);
        if (!article) return `${page} missing from articles`;
        // The same facts the export judged by. Lists are recommended but not all published in Explore.
        const facts = factsFor(page);
        const effective = (statsRow.get(page) as { effective: number } | undefined)?.effective ?? 0;
        const rank = collectionRank(
          id,
          {
            qualifying: article.qualifying,
            discussions: article.discussions,
            recommenders: article.recommenders,
            months: article.months,
            years: article.years,
            communities: article.communities.length,
            firstAt: article.firstAt,
            lastAt: article.lastAt,
            recent12m: article.recent12m,
            effective,
            inWords: article.inWords,
            mentionsOther: article.otherMentions,
            monthlyClicks: facts?.monthly_clicks ?? null,
            inCatalogue: facts !== undefined,
            bytes: facts?.bytes ?? null,
          },
          now,
        );
        if (rank === null) return `${article.title} fails the gate`;
        // The export can be up to a few minutes older than this check: allow a sliver of drift in time-based ranks.
        const inOrder = id === "rising" || id === "recent" || rank <= previous + 1e-6;
        previous = rank;
        return inOrder ? null : `${article.title} is out of order`;
      }),
    );
  }

  // Wikipedia: published ids still exist as articles.
  const live = sample(snapshot.articles, sizes.live);
  const problems: string[] = [];
  for (let i = 0; i < live.length; i += 50) {
    const batch = live.slice(i, i + 50);
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", pageids: batch.map((a) => a.id).join("|") });
    const data = pagesSchema.parse(await fetchJson(`https://en.wikipedia.org/w/api.php?${params}`, { gapMs: 340 }));
    const pages = new Map((data.query?.pages ?? []).map((page) => [page.pageid, page]));
    for (const article of batch) {
      const page = pages.get(article.id);
      if (!page || page.missing || page.ns !== 0) problems.push(`${article.id} ${article.title}: not a live article`);
      else if (page.title !== article.title) problems.push(`${article.id}: published "${article.title}", live "${page.title}"`);
    }
  }
  results.push({ name: "page ids resolve to live articles with the published title", checked: live.length, failed: problems.length, examples: problems.slice(0, 8) });
  log(`live check: ${problems.length} of ${live.length} differ`);

  fs.writeFileSync(path.join(SNAPSHOT_DIR, "verification.json"), `${JSON.stringify({ at: new Date().toISOString(), results }, null, 2)}\n`);
  return results;
}
