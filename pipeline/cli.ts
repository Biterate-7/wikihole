import { aiKey, classifyWithAi, pendingCount } from "./classify/ai.ts";
import { applyReviews, classifyPending, EFFECTIVE_LABEL } from "./classify/run.ts";
import { printSample } from "./classify/sample.ts";
import { loadClickstream, loadPages, loadProps } from "./catalogue/dumps.ts";
import { enrichCatalogue, enrichWikidata, selectForEnrichment } from "./catalogue/enrich.ts";
import { openDb, type Db } from "./db.ts";
import { exportSnapshot } from "./export.ts";
import { resolveFromCatalogue, resolveTitles } from "./resolve.ts";
import { ingestEssays } from "./sources/essays.ts";
import { ingestHackerNews } from "./sources/hackernews.ts";
import { ingestLemmy } from "./sources/lemmy.ts";
import { ingestTildes } from "./sources/tildes.ts";
import { updateStats } from "./stats.ts";
import { verifySnapshot } from "./verify.ts";

/**
 * Entry point for the data pipeline. Every step is incremental and can be
 * interrupted and re-run. See docs/discovery-pipeline.md.
 *
 *   npm run pipeline -- <command>
 */

function arg(name: string): string | undefined {
  const flag = `--${name}=`;
  return process.argv.find((a) => a.startsWith(flag))?.slice(flag.length);
}

const numeric = (name: string) => (arg(name) ? Number(arg(name)) : undefined);
const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);

const db = (): Db => openDb();

const COMMANDS: Record<string, () => Promise<void>> = {
  /* Ingestion: what people said. */
  "ingest:hn": async () => {
    for (const kind of ["story", "comment"] as const) {
      const done = await ingestHackerNews(db(), kind, {
        maxPages: numeric("max-pages"),
        onProgress: (p) => {
          if (p.items % 10000 === 0) log(`hn ${p.kind}: ${p.items} items, ${p.mentions} mentions, at ${new Date((p.cursor ?? 0) * 1000).toISOString().slice(0, 10)}`);
        },
      });
      log(`hn ${kind} finished this run: ${done.items} items, ${done.mentions} mentions${done.cursor ? " (walk incomplete)" : ""}`);
    }
  },
  "ingest:lemmy": async () => log(`lemmy: ${await ingestLemmy(db(), { maxPages: numeric("max-pages"), log })} mentions`),
  "ingest:tildes": async () => log(`tildes: ${await ingestTildes(db(), { maxTopics: numeric("max-topics"), log })} mentions`),
  "ingest:essays": async () => log(`essays: ${await ingestEssays(db(), log)} mentions`),

  /* Classification and resolution: what it means. */
  resolve: async () => {
    const store = db();
    log(`from catalogue: ${resolveFromCatalogue(store)}`);
    log(`from the API: ${await resolveTitles(store, { limit: numeric("limit"), qualifyingOnly: process.argv.includes("--qualifying-only"), log })}`);
  },
  classify: async () => {
    const store = db();
    log(`rules applied to ${classifyPending(store)} mentions`);
    log(`reviews applied to ${applyReviews(store)} mentions`);
  },
  "classify:ai": async () => {
    const store = db();
    const scope = arg("scope") === "all" ? "all" : "candidates";
    log(`${pendingCount(store, scope)} mentions in scope "${scope}"`);
    if (!aiKey()) throw new Error("Set AI_API_KEY or ANTHROPIC_API_KEY to run model-based classification.");
    log(`classified ${await classifyWithAi(store, { limit: numeric("limit") ?? 1000, scope, model: arg("model"), log })}`);
  },
  "classify:sample": async () => printSample(db(), arg("label") ?? "recommendation", numeric("size") ?? 100, numeric("seed") ?? 1),
  stats: async () => log(`recomputed ${updateStats(db())} articles`),

  /* Catalogue: what Wikipedia contains. */
  "catalogue:pages": async () => log(`articles: ${await loadPages(db(), log)}`),
  "catalogue:props": async () => log(`props: ${await loadProps(db(), log)}`),
  "catalogue:clickstream": async () => log(`articles with click data: ${await loadClickstream(db(), arg("month") ?? "2026-10", log)}`),
  "catalogue:enrich": async () => {
    const store = db();
    log(`selected: ${await selectForEnrichment(store, log)}`);
    log(`enriched: ${await enrichCatalogue(store, { limit: numeric("limit"), log })}`);
  },
  "catalogue:wikidata": async () => log(`wikidata: ${await enrichWikidata(db(), { limit: numeric("limit"), log })}`),

  /* Publishing. */
  export: async () => {
    const meta = exportSnapshot(db(), log);
    log(JSON.stringify(meta.collections));
    log(JSON.stringify(meta.human));
  },

  /* Inspection. */
  verify: async () => {
    const results = await verifySnapshot(db(), log);
    for (const result of results) log(`${result.failed === 0 ? "ok  " : "FAIL"} ${result.name}: ${result.checked} checked, ${result.failed} failed${result.examples.length ? ` e.g. ${result.examples.join("; ")}` : ""}`);
  },
  trace: async () => {
    const title = process.argv[3];
    const rows = db()
      .prepare(`
        SELECT date(m.created_at, 'unixepoch') AS day, m.community, m.kind, ${EFFECTIVE_LABEL} AS label, m.classifier, m.item_url, m.excerpt
        FROM titles t CROSS JOIN mentions m ON m.lang = t.lang AND m.raw_title = t.raw_title
        WHERE t.lang = 'en' AND t.canonical_title = ? ORDER BY m.created_at`)
      .all(title);
    for (const row of rows) console.log(JSON.stringify(row));
    log(`${rows.length} mentions of ${title}`);
  },
};

const command = process.argv[2];
const run = command ? COMMANDS[command] : undefined;
if (!run) {
  console.error(`usage: npm run pipeline -- <${Object.keys(COMMANDS).join("|")}>`);
  process.exit(1);
}
run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
