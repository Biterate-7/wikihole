import { countEvidence, type QualifyingMention } from "@/lib/curated/rank";
import { transaction, type Db } from "./db.ts";

const STATS_BATCH = 500;

/** One post linking an article twice, under its title and a redirect, is still one recommendation of it. */
export function onePerItem<T extends { item_url: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.item_url)) return false;
    seen.add(row.item_url);
    return true;
  });
}

/**
 * Recomputes statistics only for articles whose decided mentions changed (tracked
 * in dirty_titles), so adding a week of discussion never rebuilds the dataset.
 * Titles that have not been resolved yet stay dirty until they are.
 */
export function updateStats(db: Db, now = Math.floor(Date.now() / 1000)): number {
  const pages = db
    .prepare(`
      SELECT DISTINCT t.lang, t.page_id, t.canonical_title FROM dirty_titles d
      JOIN titles t ON t.lang = d.lang AND t.raw_title = d.raw_title WHERE t.page_id IS NOT NULL`)
    .all() as Array<{ lang: string; page_id: number; canonical_title: string }>;

  const mentions = db.prepare(`
    SELECT m.item_url, m.discussion_id, m.community, m.author_hash, m.created_at, m.kind, m.final_label
    FROM titles t CROSS JOIN mentions m ON m.lang = t.lang AND m.raw_title = t.raw_title
    WHERE t.lang = ? AND t.page_id = ?`);
  const upsert = db.prepare(`
    INSERT INTO article_stats (lang, page_id, title, qualifying, discussions, recommenders, months, years, communities,
      first_at, last_at, recent_12m, mentions_other, criticism, updated_at, effective, in_words)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (lang, page_id) DO UPDATE SET title = excluded.title, qualifying = excluded.qualifying, discussions = excluded.discussions,
      recommenders = excluded.recommenders, months = excluded.months, years = excluded.years, communities = excluded.communities,
      first_at = excluded.first_at, last_at = excluded.last_at, recent_12m = excluded.recent_12m, mentions_other = excluded.mentions_other,
      criticism = excluded.criticism, updated_at = excluded.updated_at, effective = excluded.effective, in_words = excluded.in_words`);
  const remove = db.prepare("DELETE FROM article_stats WHERE lang = ? AND page_id = ?");

  const write = (page: { lang: string; page_id: number; canonical_title: string }) => {
    const rows = mentions.all(page.lang, page.page_id) as Array<{
      item_url: string;
      discussion_id: string;
      community: string;
      author_hash: string | null;
      created_at: number;
      kind: string;
      final_label: string | null;
    }>;
    const qualifying: QualifyingMention[] = onePerItem(rows.filter((row) => row.final_label === "recommendation"))
      .map((row) => ({ discussionId: row.discussion_id, community: row.community, authorHash: row.author_hash, at: row.created_at, inWords: row.kind !== "submission" }));
    if (qualifying.length === 0) {
      remove.run(page.lang, page.page_id);
      return;
    }
    const counts = countEvidence(qualifying, now);
    upsert.run(
      page.lang,
      page.page_id,
      page.canonical_title,
      counts.qualifying,
      counts.discussions,
      counts.recommenders,
      counts.months,
      counts.years,
      counts.communities,
      counts.firstAt,
      counts.lastAt,
      counts.recent12m,
      rows.length - qualifying.length,
      rows.filter((row) => row.final_label === "criticism").length,
      now,
      counts.effective,
      counts.inWords,
    );
  };

  // Short transactions, so ingesters writing to the same store are never locked out for long.
  for (let start = 0; start < pages.length; start += STATS_BATCH) {
    transaction(db, () => {
      for (const page of pages.slice(start, start + STATS_BATCH)) write(page);
    });
  }
  db.exec(`
    DELETE FROM dirty_titles WHERE EXISTS (
      SELECT 1 FROM titles t WHERE t.lang = dirty_titles.lang AND t.raw_title = dirty_titles.raw_title)`);
  return pages.length;
}
