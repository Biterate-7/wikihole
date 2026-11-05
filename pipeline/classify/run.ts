import fs from "node:fs";
import path from "node:path";
import { transaction, type Db } from "../db.ts";
import { calibrate, decide, type Calibration, type DecisionInput } from "./decide.ts";
import { classifyHeuristically, HEURISTIC_VERSION, LABELS, type Label } from "./heuristic.ts";

interface Row {
  rowid: number;
  kind: "comment" | "submission" | "essay";
  source: string;
  context: string;
  raw_title: string;
  lang: string;
  discussion_title: string | null;
  points: number | null;
  links_in_text: number;
  words_in_text: number;
}

/** Stage 1: applies the rules to anything not yet judged by this version. */
export function classifyPending(db: Db, describe: (title: string) => string | null = () => null): number {
  const select = db.prepare(`
    SELECT rowid, kind, source, context, raw_title, lang, discussion_title, points, links_in_text, words_in_text
    FROM mentions WHERE (classifier IS NULL OR classifier <> ?) AND rowid > ?
    ORDER BY rowid LIMIT 20000`);
  const update = db.prepare("UPDATE mentions SET label = ?, confidence = ?, reason = ?, classifier = ? WHERE rowid = ?");
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
          articleDescription: row.lang === "en" ? describe(row.raw_title) : null,
        });
        update.run(verdict.label, verdict.confidence, verdict.reason, HEURISTIC_VERSION, row.rowid);
      }
    });
    done += rows.length;
    after = rows.at(-1)!.rowid;
  }
}

/** Labels live in the repository, so they outlive any rebuild of the working store. */
export const LABELS_DIR = path.resolve("data/labels");
/** Reviewed by hand or in a session: tunes the rules and calibrates them. */
export const REVIEWS_FILE = path.join(LABELS_DIR, "reviewed.jsonl");
/** Held out: never used to tune or calibrate. It only measures. */
export const EVAL_FILE = path.join(LABELS_DIR, "eval.jsonl");
/** The LLM stage's verdicts, whether from the batch API or a reviewed session. */
export const LLM_FILE = path.join(LABELS_DIR, "llm-review.jsonl");

export interface ReviewEntry {
  id: string;
  label: Label;
  reviewer: string;
}

export interface LlmEntry {
  id: string;
  label: Label;
  confidence: number;
  why: string;
  model: string;
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

const isLabel = (label: string) => (LABELS as readonly string[]).includes(label);

export const loadReviews = (file = REVIEWS_FILE) => readJsonl<ReviewEntry>(file).filter((entry) => isLabel(entry.label));
export const loadEval = (file = EVAL_FILE) => readJsonl<ReviewEntry & { stratum?: string }>(file).filter((entry) => isLabel(entry.label));
export const loadLlm = (file = LLM_FILE) => readJsonl<LlmEntry>(file).filter((entry) => isLabel(entry.label));

/** Copies the label files into the store. Evaluation gold also corrects its own rows, but never tunes anything. */
export function applyLabels(db: Db, files?: { reviews?: string; evaluation?: string; llm?: string }): { reviews: number; llm: number } {
  const setReview = db.prepare("UPDATE mentions SET review = ? WHERE id = ?");
  const setLlm = db.prepare("UPDATE mentions SET llm_label = ?, llm_confidence = ?, llm_reason = ?, llm_model = ? WHERE id = ?");
  const reviews = [...loadReviews(files?.reviews), ...loadEval(files?.evaluation)];
  const llm = loadLlm(files?.llm);
  transaction(db, () => {
    for (const entry of reviews) setReview.run(entry.label, entry.id);
    for (const entry of llm) setLlm.run(entry.label, entry.confidence, entry.why, entry.model, entry.id);
  });
  return { reviews: reviews.length, llm: llm.length };
}

/** Rule precision per reason, measured on labelled rows, excluding the held-out set. */
export function measureCalibration(db: Db, evaluationIds: Set<string>): Calibration {
  const rows = db
    .prepare(`
      SELECT id, kind, reason, COALESCE(review, llm_label) AS truth FROM mentions
      WHERE label = 'recommendation' AND (review IS NOT NULL OR llm_label IS NOT NULL)`)
    .all() as Array<{ id: string; kind: string; reason: string | null; truth: string }>;
  return calibrate(rows.filter((row) => !evaluationIds.has(row.id)));
}

export const CALIBRATION_FILE = path.join(LABELS_DIR, "calibration.json");

/** Stage 4: decides every mention, marking only articles whose decision changed. */
export function decideAll(db: Db, calibration: Calibration): { changed: number; total: number } {
  const select = db.prepare(`
    SELECT rowid, lang, raw_title, kind, label, reason, classifier, review, llm_label, llm_confidence, llm_model, final_label, final_confidence, decided_by
    FROM mentions WHERE rowid > ? ORDER BY rowid LIMIT 50000`);
  const update = db.prepare("UPDATE mentions SET final_label = ?, final_confidence = ?, decided_by = ? WHERE rowid = ?");
  const dirty = db.prepare("INSERT OR IGNORE INTO dirty_titles (lang, raw_title) VALUES (?, ?)");
  let changed = 0;
  let total = 0;
  let after = 0;
  for (;;) {
    const rows = select.all(after) as unknown as Array<
      DecisionInput & { rowid: number; lang: string; raw_title: string; final_label: string | null; final_confidence: number | null; decided_by: string | null }
    >;
    if (rows.length === 0) return { changed, total };
    transaction(db, () => {
      for (const row of rows) {
        const decision = decide(row, calibration);
        if (decision.label === row.final_label && decision.confidence === row.final_confidence && decision.decidedBy === row.decided_by) continue;
        update.run(decision.label, decision.confidence, decision.decidedBy, row.rowid);
        if (decision.label !== row.final_label) {
          dirty.run(row.lang, row.raw_title);
          changed++;
        }
      }
    });
    total += rows.length;
    after = rows.at(-1)!.rowid;
  }
}

/** The label that counts. */
export const FINAL_LABEL = "final_label";
