import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { setState, transaction, WORK_DIR, type Db } from "../db.ts";

/**
 * Loads Wikimedia's public database dumps. This is the only full scan of
 * Wikipedia the project performs, and it runs offline: nothing here is ever
 * touched by a page load. Re-running with a newer dump updates rows in place.
 */

export const DUMP_DIR = path.join(WORK_DIR, "dumps");

function lines(file: string): readline.Interface {
  return readline.createInterface({ input: fs.createReadStream(file, { highWaterMark: 1 << 20 }).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}

function unescapeSql(value: string): string {
  return value.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c === "0" ? "" : c));
}

const PAGE_ROW = /\((\d+),(-?\d+),'((?:[^'\\]|\\.)*)',([01]),[01],[\d.e-]+,'\d+',(?:'\d+'|NULL),\d+,(\d+),/g;

/**
 * enwiki-latest-page.sql.gz: every article's id, title and size; redirects and
 * other namespaces are skipped. The file's own timestamp says when it was
 * downloaded, not which dump it is, so the date is only recorded when given.
 */
export async function loadPages(db: Db, log: (message: string) => void, file = path.join(DUMP_DIR, "enwiki-latest-page.sql.gz"), dumpDate?: string): Promise<number> {
  const upsert = db.prepare(`
    INSERT INTO catalogue (page_id, title, bytes) VALUES (?, ?, ?)
    ON CONFLICT (page_id) DO UPDATE SET title = excluded.title, bytes = excluded.bytes`);
  let total = 0;
  let scanned = 0;
  let batch: Array<[number, string, number]> = [];
  const flush = () => {
    transaction(db, () => {
      for (const [id, title, bytes] of batch) upsert.run(id, title, bytes);
    });
    batch = [];
  };
  for await (const line of lines(file)) {
    // Current dumps put one row on each line; older ones many rows on an INSERT line.
    if (!line.startsWith("(") && !line.startsWith("INSERT INTO")) continue;
    for (const match of line.matchAll(PAGE_ROW)) {
      scanned++;
      if (match[2] !== "0" || match[4] === "1") continue;
      batch.push([Number(match[1]), unescapeSql(match[3]).replace(/_/g, " "), Number(match[5])]);
      total++;
    }
    if (batch.length >= 50000) {
      flush();
      if (total % 1000000 < 50000) log(`pages: ${total} articles of ${scanned} rows`);
    }
  }
  flush();
  setState(db, "catalogue:pages-scanned", scanned);
  setState(db, "catalogue:articles", total);
  setState(db, "catalogue:pages-dump", dumpDate ?? "unknown");
  return total;
}

const PROP_ROW = /\((\d+),'(wikibase_item|disambiguation|wikibase-shortdesc)','((?:[^'\\]|\\.)*)',(?:[\d.e+-]+|NULL)\)/g;

/** enwiki-latest-page_props.sql.gz: Wikidata item, short description and disambiguation flag. */
export async function loadProps(db: Db, log: (message: string) => void, file = path.join(DUMP_DIR, "enwiki-latest-page_props.sql.gz")): Promise<number> {
  const qid = db.prepare("UPDATE catalogue SET qid = ? WHERE page_id = ?");
  const description = db.prepare("UPDATE catalogue SET description = ? WHERE page_id = ?");
  const disambiguation = db.prepare("UPDATE catalogue SET disambiguation = 1 WHERE page_id = ?");
  let total = 0;
  let batch: Array<[number, string, string]> = [];
  const flush = () => {
    transaction(db, () => {
      for (const [id, prop, value] of batch) {
        if (prop === "wikibase_item") qid.run(value, id);
        else if (prop === "wikibase-shortdesc") description.run(value, id);
        else disambiguation.run(id);
      }
    });
    batch = [];
  };
  for await (const line of lines(file)) {
    if (!line.includes("'wikibase") && !line.includes("'disambiguation'")) continue;
    for (const match of line.matchAll(PROP_ROW)) {
      batch.push([Number(match[1]), match[2], unescapeSql(match[3])]);
      total++;
    }
    if (batch.length >= 50000) {
      flush();
      if (total % 2000000 < 50000) log(`props: ${total}`);
    }
  }
  flush();
  return total;
}

const toTitle = (value: string) => value.replace(/_/g, " ");

/**
 * clickstream-enwiki-*.tsv.gz: how readers actually move between articles in a
 * month. Gives every article its arrivals, the share from outside Wikipedia, and
 * how many other articles send readers to it. Article-to-article edges are kept
 * only where they touch a page in `targets`, to stay small.
 */
export async function loadClickstream(
  db: Db,
  month: string,
  log: (message: string) => void,
  file = path.join(DUMP_DIR, `clickstream-enwiki-${month}.tsv.gz`),
  options: { edgesOnly?: boolean } = {},
): Promise<number> {
  const targets = new Set(
    (db.prepare("SELECT c.title FROM targets t JOIN catalogue c ON c.page_id = t.page_id").all() as Array<{ title: string }>).map((row) => row.title),
  );
  const totals = new Map<string, { clicks: number; external: number; inbound: number }>();
  const edges: Array<[string, string, number]> = [];
  let rows = 0;
  for await (const line of lines(file)) {
    const [prev, curr, type, n] = line.split("\t");
    const clicks = Number(n);
    if (!curr || !Number.isFinite(clicks)) continue;
    rows++;
    const title = toTitle(curr);
    let entry = totals.get(title);
    if (!entry) {
      entry = { clicks: 0, external: 0, inbound: 0 };
      totals.set(title, entry);
    }
    entry.clicks += clicks;
    if (prev.startsWith("other-")) {
      if (prev !== "other-internal") entry.external += clicks;
    } else if (type === "link") {
      entry.inbound++;
      const from = toTitle(prev);
      if (clicks >= 20 && (targets.has(title) || targets.has(from))) edges.push([from, title, clicks]);
    }
    if (rows % 5000000 === 0) log(`clickstream: ${rows} rows, ${totals.size} articles`);
  }
  log(`clickstream parsed: ${rows} rows, ${totals.size} articles, ${edges.length} edges`);

  const update = db.prepare("UPDATE catalogue SET monthly_clicks = ?, external_share = ?, inbound_pages = ? WHERE title = ?");
  let done = 0;
  let open = false;
  // When only the set of targets changed, the per-article totals are already right.
  for (const [title, entry] of options.edgesOnly ? [] : totals) {
    if (!open) {
      db.exec("BEGIN");
      open = true;
    }
    update.run(entry.clicks, entry.clicks ? entry.external / entry.clicks : 0, entry.inbound, title);
    if (++done % 100000 === 0) {
      db.exec("COMMIT");
      open = false;
      if (done % 1000000 === 0) log(`clickstream stored: ${done}`);
    }
  }
  if (open) db.exec("COMMIT");

  const idOf = db.prepare("SELECT page_id FROM catalogue WHERE title = ?");
  const insert = db.prepare("INSERT OR REPLACE INTO edges (from_page, to_page, clicks) VALUES (?, ?, ?)");
  transaction(db, () => {
    db.exec("DELETE FROM edges");
    for (const [from, to, clicks] of edges) {
      const a = idOf.get(from) as { page_id: number } | undefined;
      const b = idOf.get(to) as { page_id: number } | undefined;
      if (a && b) insert.run(a.page_id, b.page_id, clicks);
    }
  });
  setState(db, "catalogue:clickstream-month", month);
  setState(db, "catalogue:clickstream-rows", rows);
  return totals.size;
}
