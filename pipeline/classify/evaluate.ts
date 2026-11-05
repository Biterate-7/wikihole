import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db.ts";
import { WORK_DIR } from "../db.ts";
import { loadEval } from "./run.ts";

/**
 * Measures the classifier on the held-out set. The set is stratified by what the
 * rules said, so recall can be estimated: each stratum's share of true
 * recommendations is scaled up by that stratum's real size.
 */

export interface StratumResult {
  stratum: string;
  population: number;
  labelled: number;
  recommendations: number;
}

export interface Rate {
  value: number | null;
  low: number | null;
  high: number | null;
  n: number;
}

/** 95% Wilson interval, honest at small samples. */
export function wilson(successes: number, n: number): Rate {
  if (n === 0) return { value: null, low: null, high: null, n: 0 };
  const z = 1.96;
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return { value: p, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin), n };
}

export interface Evaluation {
  labeller: string;
  labelled: number;
  strata: StratumResult[];
  comments: { rulePrecision: Rate; estimatedRuleRecall: number | null; estimatedTrueRecommendations: number | null };
  submissions: { rulePrecision: Rate; estimatedRuleRecall: number | null };
  decided: { acceptedPrecision: Rate };
}

const STRATUM = "kind || ':' || COALESCE(label, 'none')";

export function evaluate(db: Db): Evaluation {
  const gold = loadEval();
  const labels = new Map(gold.map((entry) => [entry.id, entry.label]));
  const population = new Map(
    (db.prepare(`SELECT ${STRATUM} AS stratum, count(*) AS n FROM mentions GROUP BY stratum`).all() as Array<{ stratum: string; n: number }>).map((row) => [row.stratum, row.n]),
  );
  const lookup = db.prepare(`SELECT ${STRATUM} AS stratum, label, final_label FROM mentions WHERE id = ?`);
  const tally = new Map<string, { labelled: number; recommendations: number }>();
  let accepted = 0;
  let acceptedTrue = 0;
  for (const [id, truth] of labels) {
    const row = lookup.get(id) as { stratum: string; label: string; final_label: string | null } | undefined;
    if (!row) continue;
    const entry = tally.get(row.stratum) ?? { labelled: 0, recommendations: 0 };
    entry.labelled++;
    if (truth === "recommendation") entry.recommendations++;
    tally.set(row.stratum, entry);
    // Would the rules and calibration alone have counted it? Reviews of held-out rows are ignored here.
    if (row.label === "recommendation" && autoAccepted(db, id)) {
      accepted++;
      if (truth === "recommendation") acceptedTrue++;
    }
  }
  const strata = [...tally].map(([stratum, { labelled, recommendations }]) => ({ stratum, population: population.get(stratum) ?? 0, labelled, recommendations })).sort((a, b) => a.stratum.localeCompare(b.stratum));

  const estimate = (kind: string) => {
    const rows = strata.filter((s) => s.stratum.startsWith(`${kind}:`));
    const total = rows.reduce((sum, s) => sum + (s.labelled ? (s.population * s.recommendations) / s.labelled : 0), 0);
    const counted = rows.find((s) => s.stratum === `${kind}:recommendation`);
    const found = counted && counted.labelled ? (counted.population * counted.recommendations) / counted.labelled : 0;
    return {
      rulePrecision: wilson(counted?.recommendations ?? 0, counted?.labelled ?? 0),
      estimatedRuleRecall: total > 0 ? found / total : null,
      estimatedTrueRecommendations: total > 0 ? Math.round(total) : null,
    };
  };
  const comments = estimate("comment");
  const { rulePrecision, estimatedRuleRecall } = estimate("submission");
  return {
    labeller: [...new Set(gold.map((entry) => entry.reviewer))].join(", "),
    labelled: labels.size,
    strata,
    comments,
    submissions: { rulePrecision, estimatedRuleRecall },
    decided: { acceptedPrecision: wilson(acceptedTrue, accepted) },
  };
}

/** Whether a held-out row's rule would be auto-accepted, read from the stored calibration. */
function autoAccepted(db: Db, id: string): boolean {
  const row = db.prepare("SELECT kind, reason FROM mentions WHERE id = ?").get(id) as { kind: string; reason: string | null };
  const file = path.resolve("data/labels/calibration.json");
  if (!fs.existsSync(file)) return false;
  const calibration = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { checked: number; precision: number }>;
  const measured = calibration[`${row.kind}|${row.reason ?? ""}`];
  return Boolean(measured && measured.checked >= 15 && measured.precision >= 0.85);
}

/** A sheet a person can use to check the labels independently. */
export function writeEvalSheet(db: Db): string {
  const file = path.join(WORK_DIR, "eval-sheet.csv");
  const lookup = db.prepare("SELECT raw_title, discussion_title, context, item_url FROM mentions WHERE id = ?");
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const lines = ["id,article,thread,text,url,claude_label,your_label"];
  for (const entry of loadEval()) {
    const row = lookup.get(entry.id) as { raw_title: string; discussion_title: string | null; context: string; item_url: string } | undefined;
    if (row) lines.push([entry.id, row.raw_title, row.discussion_title, row.context, row.item_url, entry.label, ""].map(cell).join(","));
  }
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}
