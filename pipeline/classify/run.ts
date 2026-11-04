import fs from "node:fs";
import path from "node:path";
import { transaction, type Db } from "../db.ts";
import { classifyHeuristically, HEURISTIC_VERSION, LABELS, type Label } from "./heuristic.ts";

interface Row {
  rowid: number;
  kind: "comment" | "submission" | "essay";
  source: string;
  context: string;
  raw_title: string;
  discussion_title: string | null;
  points: number | null;
  links_in_text: number;
  words_in_text: number;
  description: string | null;
}

/** Applies the rules to anything not yet judged by this version. Model verdicts are left alone. */
export function classifyPending(db: Db): number {
  const select = db.prepare(`
    SELECT m.rowid AS rowid, m.kind, m.source, m.context, m.raw_title, m.discussion_title, m.points, m.links_in_text, m.words_in_text, c.description
    FROM mentions m LEFT JOIN catalogue c ON m.lang = 'en' AND c.title = m.raw_title
    WHERE (m.classifier IS NULL OR (m.classifier LIKE 'heuristic-%' AND m.classifier <> ?)) AND m.rowid > ?
    ORDER BY m.rowid LIMIT 20000`);
  const update = db.prepare("UPDATE mentions SET label = ?, confidence = ?, reason = ?, classifier = ? WHERE rowid = ?");
  const dirty = db.prepare("INSERT OR IGNORE INTO dirty_titles (lang, raw_title) SELECT lang, raw_title FROM mentions WHERE rowid = ?");
  let done = 0;
  let after = 0;
  for (;;) {
    const rows = select.all(HEURISTIC_VERSION, after) as unknown as Row[];
    if (rows.length === 0) return done;
    transaction(db, () => {
      for (const row of rows) {
        const verdict = classifyHeuristically({
          kind: row.kind,
          source: row.source,
          context: row.context,
          title: row.raw_title,
          discussionTitle: row.discussion_title,
          points: row.points,
          linksInText: row.links_in_text,
          wordsInText: row.words_in_text,
          articleDescription: row.description,
        });
        update.run(verdict.label, verdict.confidence, verdict.reason, HEURISTIC_VERSION, row.rowid);
        dirty.run(row.rowid);
      }
    });
    done += rows.length;
    after = rows.at(-1)!.rowid;
  }
}

/** Reviewed labels live in the repository, so they outlive any rebuild of the working store. */
export const REVIEWS_FILE = path.resolve("data/labels/reviewed.jsonl");

export interface ReviewEntry {
  id: string;
  label: Label;
  reviewer: string;
}

export function loadReviews(file = REVIEWS_FILE): ReviewEntry[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReviewEntry)
    .filter((entry) => (LABELS as readonly string[]).includes(entry.label));
}

export function applyReviews(db: Db): number {
  const reviews = loadReviews();
  const update = db.prepare("UPDATE mentions SET review = ? WHERE id = ? AND (review IS NULL OR review <> ?)");
  const dirty = db.prepare("INSERT OR IGNORE INTO dirty_titles (lang, raw_title) SELECT lang, raw_title FROM mentions WHERE id = ?");
  let changed = 0;
  transaction(db, () => {
    for (const review of reviews) {
      if (update.run(review.label, review.id, review.label).changes > 0) {
        dirty.run(review.id);
        changed++;
      }
    }
  });
  return changed;
}

/** The label that counts: a review outranks a model, which outranks the rules. */
export const EFFECTIVE_LABEL = "COALESCE(review, label)";
