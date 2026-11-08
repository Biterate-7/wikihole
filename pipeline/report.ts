import fs from "node:fs";
import path from "node:path";
import type { Db } from "./db.ts";
import { getState } from "./db.ts";
import { SNAPSHOT_DIR } from "./export.ts";

/**
 * The pipeline's account of itself: what was read, what came of it, what failed
 * and what is known to be missing. Written from the stores and the run log, never
 * by hand. Published as data/snapshot/pipeline-report.json.
 */

interface RunRecord {
  command: string;
  status: string;
  error?: string;
  note?: string;
  startedAt?: string;
  http?: { requests: number; retries: number; failures: number; byStatus: Record<string, number> };
}

export function buildReport(human: Db, catalogue: Db, runLog: string) {
  const runs: RunRecord[] = fs.existsSync(runLog)
    ? fs
        .readFileSync(runLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RunRecord)
    : [];
  const byCommand = new Map<string, { runs: number; completed: number; failed: number; requests: number; retries: number; httpFailures: number; statuses: Record<string, number>; errors: string[] }>();
  for (const run of runs) {
    const entry = byCommand.get(run.command) ?? { runs: 0, completed: 0, failed: 0, requests: 0, retries: 0, httpFailures: 0, statuses: {}, errors: [] };
    entry.runs++;
    if (run.status === "completed") entry.completed++;
    if (run.status === "failed") entry.failed++;
    entry.requests += run.http?.requests ?? 0;
    entry.retries += run.http?.retries ?? 0;
    entry.httpFailures += run.http?.failures ?? 0;
    for (const [status, n] of Object.entries(run.http?.byStatus ?? {})) entry.statuses[status] = (entry.statuses[status] ?? 0) + n;
    if (run.error) entry.errors.push(run.error);
    byCommand.set(run.command, entry);
  }
  const all = <T>(db: Db, sql: string) => db.prepare(sql).all() as unknown as T[];
  const one = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    generatedAt: new Date().toISOString(),
    human: {
      bySource: all(
        human,
        `SELECT source, kind, count(*) AS mentions, count(DISTINCT item_url) AS items, count(DISTINCT discussion_id) AS discussions,
           sum(final_label = 'recommendation') AS qualifying, sum(final_label = 'needs-review') AS undecided,
           date(min(created_at), 'unixepoch') AS oldest, date(max(created_at), 'unixepoch') AS newest
         FROM mentions GROUP BY source, kind ORDER BY source, kind`,
      ),
      checkpoints: {
        lemmyNextPage: getState(human, "lemmy:page"),
        lemmyComplete: getState(human, "lemmy:complete"),
        tildesAfter: getState(human, "tildes:after"),
      },
      languages: all(human, "SELECT lang, count(*) AS mentions FROM mentions GROUP BY lang ORDER BY mentions DESC LIMIT 12"),
      resolution: all(human, "SELECT lang = 'en' AS english, status, count(*) AS titles FROM titles GROUP BY english, status ORDER BY english DESC, titles DESC"),
      unresolvedMentions: one(human, "SELECT count(*) AS n FROM mentions m WHERE NOT EXISTS (SELECT 1 FROM titles t WHERE t.lang = m.lang AND t.raw_title = m.raw_title)"),
      unusableMentions: one(human, "SELECT count(*) AS n FROM mentions m JOIN titles t ON t.lang = m.lang AND t.raw_title = m.raw_title WHERE t.page_id IS NULL"),
      labels: all(human, "SELECT kind, COALESCE(final_label, 'unclassified') AS decided, count(*) AS mentions FROM mentions GROUP BY kind, decided ORDER BY kind, mentions DESC"),
      deciders: all(human, "SELECT COALESCE(decided_by, 'unclassified') AS decided_by, final_label AS label, count(*) AS mentions FROM mentions WHERE final_label = 'recommendation' GROUP BY 1, 2 ORDER BY mentions DESC"),
      queues: {
        ambiguous: one(human, "SELECT count(*) AS n FROM mentions WHERE final_label = 'needs-review'"),
        recallCandidates: one(human, "SELECT count(*) AS n FROM mentions WHERE label = 'interesting' AND kind = 'comment' AND review IS NULL AND llm_label IS NULL"),
      },
      mostMentionedControl: all(
        human,
        `SELECT title, qualifying, in_words AS inWords, mentions_other AS otherMentions FROM article_stats WHERE lang = 'en' ORDER BY mentions_other + qualifying DESC LIMIT 15`,
      ),
    },
    catalogue: {
      articles: one(catalogue, "SELECT count(*) AS n FROM catalogue"),
      pagesDump: getState(catalogue, "catalogue:pages-dump"),
      rowsRead: getState(catalogue, "catalogue:pages-scanned"),
      clickstreamMonth: getState(catalogue, "catalogue:clickstream-month"),
      enrichmentPending: one(catalogue, "SELECT count(*) AS n FROM catalogue WHERE sources IS NOT NULL AND last_revision IS NULL"),
    },
    runs: Object.fromEntries(byCommand),
    reconstructed: runs.filter((run) => run.note).map((run) => ({ command: run.command, status: run.status, error: run.error, note: run.note })),
  };
}

export function printReport(human: Db, catalogue: Db, runLog: string): void {
  const report = buildReport(human, catalogue, runLog);
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SNAPSHOT_DIR, "pipeline-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 1));
}
