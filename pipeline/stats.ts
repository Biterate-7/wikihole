import { countEvidence, type QualifyingMention } from "@/lib/curated/rank";
import { EFFECTIVE_LABEL } from "./classify/run.ts";
import { transaction, type Db } from "./db.ts";

const STATS_BATCH = 500;

/**
 * Recomputes statistics only for articles whose mentions changed (tracked in
 * dirty_titles), so adding a week of discussion never rebuilds the dataset.
 * Titles that have not been resolved yet stay dirty until they are.
 */
export function updateStats(db: Db, now = Math.floor(Date.now() / 1000)): number {
  // Add the column to working stores created before it existed.
  const columns = db.prepare("PRAGMA table_info(article_stats)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "effective")) db.exec("ALTER TABLE article_stats ADD COLUMN effective REAL NOT NULL DEFAULT 0");

  const pages = db
    .prepare(`
      SELECT DISTINCT t.lang, t.page_id, t.canonical_title FROM dirty_titles d
      JOIN titles t ON t.lang = d.lang AND t.raw_title = d.raw_title WHERE t.page_id IS NOT NULL`)
    .all() as Array<{ lang: string; page_id: number; canonical_title: string }>;

  const mentions = db.prepare(`
    SELECT m.discussion_id, m.community, m.author_hash, m.created_at, ${EFFECTIVE_LABEL} AS effective_label
    FROM titles t CROSS JOIN mentions m ON m.lang = t.lang AND m.raw_title = t.raw_title
    WHERE t.lang = ? AND t.page_id = ?`);
  const upsert = db.prepare(`
    INSERT INTO article_stats (lang, page_id, title, qualifying, discussions, recommenders, months, years, communities,
      first_at, last_at, recent_12m, mentions_other, criticism, updated_at, effective)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (lang, page_id) DO UPDATE SET title = excluded.title, qualifying = excluded.qualifying, discussions = excluded.discussions,
      recommenders = excluded.recommenders, months = excluded.months, years = excluded.years, communities = excluded.communities,
      first_at = excluded.first_at, last_at = excluded.last_at, recent_12m = excluded.recent_12m, mentions_other = excluded.mentions_other,
      criticism = excluded.criticism, updated_at = excluded.updated_at, effective = excluded.effective`);
  const remove = db.prepare("DELETE FROM article_stats WHERE lang = ? AND page_id = ?");

  // Short transactions, so ingesters writing to the same store are never locked out for long.
  for (let start = 0; start < pages.length; start += STATS_BATCH) {
    transaction(db, () => {
      for (const page of pages.slice(start, start + STATS_BATCH)) writeStats(page);
    });
  }
  db.exec(`
    DELETE FROM dirty_titles WHERE EXISTS (
      SELECT 1 FROM titles t WHERE t.lang = dirty_titles.lang AND t.raw_title = dirty_titles.raw_title)`);
  return pages.length;

  function writeStats(page: { lang: string; page_id: number; canonical_title: string }): void {
      const rows = mentions.all(page.lang, page.page_id) as Array<{
        discussion_id: string;
        community: string;
        author_hash: string | null;
        created_at: number;
        effective_label: string | null;
      }>;
      const qualifying: QualifyingMention[] = rows
        .filter((row) => row.effective_label === "recommendation")
        .map((row) => ({ discussionId: row.discussion_id, community: row.community, authorHash: row.author_hash, at: row.created_at }));
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
        rows.filter((row) => row.effective_label === "criticism").length,
        now,
        counts.effective,
      );
  }
}
