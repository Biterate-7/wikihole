import type { Db } from "../db.ts";

/**
 * Draws a repeatable random sample for review, so the classifier's precision can
 * be measured instead of assumed. Prints one JSON line per mention.
 */
export function printSample(db: Db, label: string, size: number, seed: number): void {
  const rows = db
    .prepare(`
      SELECT id, kind, raw_title AS article, discussion_title AS thread, points, context, reason
      FROM mentions WHERE COALESCE(review, label) = ? AND review IS NULL
      ORDER BY (rowid * 2654435761 + ?) % 4294967296 LIMIT ?`)
    .all(label, seed, size);
  for (const row of rows) console.log(JSON.stringify(row));
}
