import fs from "node:fs";
import path from "node:path";
import { aiKey, classifyWithAi, queueSize, readQueue, type Queue } from "./classify/ai.ts";
import { writeEvalSheet } from "./classify/evaluate.ts";
import { applyLabels, CALIBRATION_FILE, classifyPending, decideAll, loadEval, measureCalibration } from "./classify/run.ts";
import { loadClickstream, loadPages, loadProps } from "./catalogue/dumps.ts";
import { enrichCatalogue, enrichWikidata, selectForEnrichment } from "./catalogue/enrich.ts";
import { openCatalogue, openHuman, transaction, WORK_DIR } from "./db.ts";
import { exportCatalogue, exportHuman, type PageFacts } from "./export.ts";
import { httpCounters } from "./http.ts";
import { printReport } from "./report.ts";
import { resolveFromCatalogue, resolveTitles } from "./resolve.ts";
import { ingestEssays } from "./sources/essays.ts";
import { ingestLemmy } from "./sources/lemmy.ts";
import { ingestTildes } from "./sources/tildes.ts";
import { updateStats } from "./stats.ts";
import { verifySnapshot } from "./verify.ts";

/**
 * Entry point for the data pipeline. Every step is incremental and can be
 * interrupted and re-run; each run is logged with its failures. See
 * docs/discovery-pipeline.md.
 *
 *   npm run pipeline -- <command>
 */

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

const numeric = (name: string) => (arg(name) ? Number(arg(name)) : undefined);
const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

export const RUN_LOG = path.join(WORK_DIR, "runs.jsonl");

const outcome: Record<string, unknown> = {};

const COMMANDS: Record<string, () => Promise<void>> = {
  /* Human dataset: ingestion. */
  "ingest:lemmy": async () => {
    outcome.mentions = await ingestLemmy(openHuman(), { maxPages: numeric("max-pages"), log });
    log(`lemmy: ${outcome.mentions} mentions`);
  },
  "ingest:tildes": async () => {
    outcome.mentions = await ingestTildes(openHuman(), { maxTopics: numeric("max-topics"), log });
    log(`tildes: ${outcome.mentions} mentions`);
  },
  "ingest:essays": async () => {
    outcome.mentions = await ingestEssays(openHuman(), log);
    log(`essays: ${outcome.mentions} mentions`);
  },

  /* Human dataset: what the mentions mean. */
  resolve: async () => {
    const human = openHuman();
    outcome.fromCatalogue = resolveFromCatalogue(human, openCatalogue());
    log(`from catalogue: ${outcome.fromCatalogue}`);
    outcome.fromApi = await resolveTitles(human, { limit: numeric("limit"), qualifyingOnly: process.argv.includes("--qualifying-only"), log });
    log(`from the API: ${outcome.fromApi}`);
  },
  classify: async () => {
    const human = openHuman();
    const catalogue = openCatalogue();
    const find = catalogue.prepare("SELECT description FROM catalogue WHERE title = ?");
    outcome.ruled = classifyPending(human, (title) => (find.get(title) as { description: string | null } | undefined)?.description ?? null);
    log(`stage 1, rules: ${outcome.ruled} mentions`);
    const applied = applyLabels(human);
    log(`stage 2, labels applied: ${applied.reviews} reviews, ${applied.llm} model verdicts`);
    const calibration = measureCalibration(human, new Set(loadEval().map((entry) => entry.id)));
    fs.writeFileSync(CALIBRATION_FILE, `${JSON.stringify(calibration, null, 2)}\n`);
    for (const [key, value] of Object.entries(calibration).sort((a, b) => b[1].precision - a[1].precision)) log(`  ${value.precision.toFixed(2)} (${value.confirmed}/${value.checked}) ${key}`);
    const decided = decideAll(human, calibration);
    outcome.decisionsChanged = decided.changed;
    log(`stage 4, decisions: ${decided.changed} changed of ${decided.total}`);
  },
  "classify:ai": async () => {
    const human = openHuman();
    const queue: Queue = arg("queue") === "recall" ? "recall" : "ambiguous";
    log(`${queueSize(human, queue)} mentions in the ${queue} queue`);
    if (!aiKey()) throw new Error("Set AI_API_KEY or ANTHROPIC_API_KEY to run model-based classification.");
    outcome.verdicts = await classifyWithAi(human, { limit: numeric("limit") ?? 1000, queue, model: arg("model"), log });
  },
  "classify:queue": async () => {
    const human = openHuman();
    const queue: Queue = arg("queue") === "recall" ? "recall" : "ambiguous";
    log(`${queueSize(human, queue)} mentions in the ${queue} queue`);
    for (const row of readQueue(human, queue, numeric("limit") ?? 20)) console.log(JSON.stringify(row));
  },
  "eval:sheet": async () => log(`wrote ${writeEvalSheet(openHuman())}`),
  stats: async () => {
    outcome.recomputed = updateStats(openHuman());
    log(`recomputed ${outcome.recomputed} articles`);
  },

  /* Knowledge dataset. */
  "catalogue:pages": async () => {
    const dumpDate = arg("dump-date");
    if (dumpDate && !/^\d{4}-\d{2}-\d{2}$/.test(dumpDate)) throw new Error("--dump-date must be YYYY-MM-DD");
    if (!dumpDate) log("no --dump-date given: the catalogue will say its dump date is unknown");
    outcome.articles = await loadPages(openCatalogue(), log, undefined, dumpDate);
    log(`articles: ${outcome.articles}`);
  },
  "catalogue:props": async () => {
    outcome.props = await loadProps(openCatalogue(), log);
    log(`props: ${outcome.props}`);
  },
  "catalogue:clickstream": async () => {
    outcome.withClicks = await loadClickstream(openCatalogue(), arg("month") ?? "2026-10", log, undefined, { edgesOnly: process.argv.includes("--edges-only") });
    log(`articles with click data: ${outcome.withClicks}`);
  },
  "catalogue:enrich": async () => {
    const catalogue = openCatalogue();
    log(`selected: ${await selectForEnrichment(catalogue, log)}`);
    outcome.enriched = await enrichCatalogue(catalogue, { limit: numeric("limit"), log });
    log(`enriched: ${outcome.enriched}`);
  },
  "catalogue:wikidata": async () => {
    outcome.wikidata = await enrichWikidata(openCatalogue(), { limit: numeric("limit"), log });
    log(`wikidata: ${outcome.wikidata}`);
  },

  /* The one connection: the human dataset asks the catalogue about its page ids. */
  connect: async () => {
    const human = openHuman();
    const catalogue = openCatalogue();
    const pages = human.prepare("SELECT page_id FROM article_stats WHERE lang = 'en'").all() as Array<{ page_id: number }>;
    const insert = catalogue.prepare("INSERT OR IGNORE INTO targets (page_id) VALUES (?)");
    transaction(catalogue, () => {
      for (const { page_id } of pages) insert.run(page_id);
    });
    outcome.targets = pages.length;
    log(`catalogue asked about ${pages.length} recommended pages`);
  },

  /* Publishing: each dataset on its own. */
  "export:human": async () => {
    const catalogue = openCatalogue();
    const facts = catalogue.prepare("SELECT monthly_clicks, bytes, disambiguation FROM catalogue WHERE page_id = ?");
    const meta = exportHuman(openHuman(), (id) => facts.get(id) as PageFacts | undefined, log);
    log(JSON.stringify(meta.collections));
    log(JSON.stringify(meta.totals));
  },
  "export:catalogue": async () => {
    const meta = exportCatalogue(openCatalogue(), log);
    log(JSON.stringify(meta.scan));
    log(JSON.stringify(meta.enrichment));
  },

  /* Inspection. */
  verify: async () => {
    const facts = openCatalogue().prepare("SELECT monthly_clicks, bytes, disambiguation FROM catalogue WHERE page_id = ?");
    const results = await verifySnapshot(openHuman(), (id) => facts.get(id) as PageFacts | undefined, log);
    for (const result of results) log(`${result.failed === 0 ? "ok  " : "FAIL"} ${result.name}: ${result.checked} checked, ${result.failed} failed${result.examples.length ? ` e.g. ${result.examples.join("; ")}` : ""}`);
  },
  report: async () => printReport(openHuman(), openCatalogue(), RUN_LOG),
  trace: async () => {
    const title = process.argv[3];
    const rows = openHuman()
      .prepare(`
        SELECT date(m.created_at, 'unixepoch') AS day, m.community, m.kind, m.final_label AS label, m.decided_by, m.item_url, m.excerpt
        FROM titles t CROSS JOIN mentions m ON m.lang = t.lang AND m.raw_title = t.raw_title
        WHERE t.lang = 'en' AND t.canonical_title = ? ORDER BY m.created_at`)
      .all(title);
    for (const row of rows) console.log(JSON.stringify(row));
    log(`${rows.length} mentions of ${title}`);
  },
};

const LOGGED_QUIETLY = new Set(["report", "trace", "classify:queue", "eval:sheet"]);

function recordRun(command: string, startedAt: string, status: string, error?: unknown): void {
  if (LOGGED_QUIETLY.has(command)) return;
  fs.mkdirSync(path.dirname(RUN_LOG), { recursive: true });
  fs.appendFileSync(
    RUN_LOG,
    `${JSON.stringify({
      command,
      args: process.argv.slice(3),
      startedAt,
      finishedAt: new Date().toISOString(),
      status,
      ...(error ? { error: error instanceof Error ? error.message.slice(0, 300) : String(error) } : {}),
      http: httpCounters,
      outcome,
    })}\n`,
  );
}

const command = process.argv[2];
const run = command ? COMMANDS[command] : undefined;
if (!run) {
  console.error(`usage: npm run pipeline -- <${Object.keys(COMMANDS).join("|")}>`);
  process.exit(1);
}
const startedAt = new Date().toISOString();
run()
  .then(() => recordRun(command, startedAt, "completed"))
  .catch((error: unknown) => {
    recordRun(command, startedAt, "failed", error);
    console.error(error);
    process.exit(1);
  });
