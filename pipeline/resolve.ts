import { z } from "zod";
import { wikipediaDomain } from "@/lib/i18n/languages";
import { transaction, type Db } from "./db.ts";
import { fetchJson } from "./http.ts";

/**
 * Maps every raw title to one canonical article: redirects are followed, and
 * pages that do not exist or are not articles are recorded as such so they are
 * neither counted nor asked about again. English titles already present in the
 * catalogue dump resolve without a request.
 */

const responseSchema = z.object({
  query: z
    .object({
      normalized: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      redirects: z.array(z.object({ from: z.string(), to: z.string() })).optional(),
      pages: z
        .array(
          z.object({
            pageid: z.number().optional(),
            ns: z.number().optional(),
            title: z.string(),
            missing: z.boolean().optional(),
            invalid: z.boolean().optional(),
            pageprops: z.record(z.string(), z.string()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

const BATCH = 50;
/** About 180 requests a minute, under Wikimedia's 200 for a client with contact details. */
const GAP_MS = 340;

export function resolveFromCatalogue(db: Db, catalogue: Db): number {
  const pending = db
    .prepare("SELECT DISTINCT raw_title FROM mentions m WHERE lang = 'en' AND NOT EXISTS (SELECT 1 FROM titles t WHERE t.lang = 'en' AND t.raw_title = m.raw_title)")
    .all() as Array<{ raw_title: string }>;
  const find = catalogue.prepare("SELECT page_id, title, disambiguation FROM catalogue WHERE title = ?");
  const insert = db.prepare("INSERT OR IGNORE INTO titles (lang, raw_title, page_id, canonical_title, status, checked_at) VALUES ('en', ?, ?, ?, ?, unixepoch())");
  let resolved = 0;
  transaction(db, () => {
    for (const { raw_title } of pending) {
      const page = find.get(raw_title) as { page_id: number; title: string; disambiguation: number } | undefined;
      if (!page) continue;
      insert.run(raw_title, page.page_id, page.title, page.disambiguation === 1 ? "disambiguation" : "ok");
      resolved++;
    }
  });
  return resolved;
}

export async function resolveTitles(db: Db, options: { lang?: string; limit?: number; qualifyingOnly?: boolean; log?: (message: string) => void } = {}): Promise<number> {
  const langs = options.lang
    ? [options.lang]
    : (db.prepare("SELECT DISTINCT lang FROM mentions").all() as Array<{ lang: string }>).map((row) => row.lang);
  const insert = db.prepare(`
    INSERT INTO titles (lang, raw_title, page_id, canonical_title, status, checked_at) VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT (lang, raw_title) DO UPDATE SET page_id = excluded.page_id, canonical_title = excluded.canonical_title, status = excluded.status, checked_at = excluded.checked_at`);
  let resolved = 0;
  for (const lang of langs) {
    const pending = db.prepare(`
      SELECT DISTINCT raw_title FROM mentions m
      WHERE lang = ? ${options.qualifyingOnly ? "AND final_label IN ('recommendation', 'needs-review')" : ""}
        AND NOT EXISTS (SELECT 1 FROM titles t WHERE t.lang = m.lang AND t.raw_title = m.raw_title)
      LIMIT ?`);
    for (;;) {
      if (options.limit !== undefined && resolved >= options.limit) return resolved;
      const rows = pending.all(lang, BATCH) as Array<{ raw_title: string }>;
      if (rows.length === 0) break;
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        redirects: "1",
        prop: "pageprops",
        ppprop: "disambiguation",
        titles: rows.map((row) => row.raw_title).join("|"),
      });
      const data = responseSchema.parse(await fetchJson(`https://${wikipediaDomain(lang)}/w/api.php?${params}`, { gapMs: GAP_MS }));
      const pages = new Map((data.query?.pages ?? []).map((page) => [page.title, page]));
      const aliases = new Map<string, string>();
      for (const alias of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) aliases.set(alias.from, alias.to);
      transaction(db, () => {
        for (const { raw_title } of rows) {
          let current = raw_title;
          let redirected = false;
          for (let hop = 0; hop < 5 && aliases.has(current); hop++) {
            current = aliases.get(current)!;
            redirected = true;
          }
          const page = pages.get(current);
          let status = "missing";
          if (page && !page.missing && !page.invalid && page.pageid !== undefined) {
            status = page.ns !== 0 ? "not-article" : page.pageprops && "disambiguation" in page.pageprops ? "disambiguation" : redirected && current !== raw_title ? "redirected" : "ok";
          }
          const valid = status === "ok" || status === "redirected" || status === "disambiguation";
          insert.run(lang, raw_title, valid ? page!.pageid! : null, valid ? page!.title : null, status, );
          resolved++;
        }
      });
      if (resolved % 5000 < BATCH) options.log?.(`resolved ${resolved} titles (${lang})`);
    }
  }
  return resolved;
}
