import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadClickstream, loadPages, loadProps } from "../../pipeline/catalogue/dumps";
import { enrichWikidata } from "../../pipeline/catalogue/enrich";
import { getState, openCatalogue, type Db } from "../../pipeline/db";

/** Dump parsing, against rows copied from the real files' format. */

let dir: string;
let db: Db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikihole-dumps-"));
  db = openCatalogue(path.join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const dump = (name: string, lines: string[]) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, zlib.gzipSync(lines.join("\n")));
  return file;
};
const log = () => {};

const pageRow = (id: number, title: string, ns = 0, redirect = 0, bytes = 5000) =>
  `(${id},${ns},'${title}',${redirect},0,0.856935107283,'20260920210900','20260920233244',1367012995,${bytes},'wikitext',NULL),`;

describe("Wikimedia dumps", () => {
  it("loads articles from the one-row-per-line format, skipping redirects and other namespaces", async () => {
    const file = dump("page.sql.gz", [
      "CREATE TABLE `page` (",
      ") ENGINE=InnoDB;",
      "INSERT INTO `page` VALUES",
      pageRow(10, "AccessibleComputing", 0, 1, 111),
      pageRow(12, "Anarchism", 0, 0, 114294),
      pageRow(13, "Village_pump", 4),
      "(14,0,'Hobson\\'s_choice',0,1,1e-05,'20261006030401',NULL,1378247183,7000,'wikitext',NULL);",
    ]);
    expect(await loadPages(db, log, file)).toBe(2);
    expect(db.prepare("SELECT page_id, title, bytes FROM catalogue ORDER BY page_id").all()).toEqual([
      { page_id: 12, title: "Anarchism", bytes: 114294 },
      { page_id: 14, title: "Hobson's choice", bytes: 7000 },
    ]);
  });

  it("also reads the older many-rows-per-INSERT format", async () => {
    const line = `INSERT INTO \`page\` VALUES ${pageRow(1, "Alpha")}${pageRow(2, "Beta")}`;
    expect(await loadPages(db, log, dump("page.sql.gz", [line]), "2026-10-08")).toBe(2);
    expect(getState(db, "catalogue:pages-dump")).toBe("2026-10-08");
  });

  it("adds Wikidata items, descriptions and disambiguation flags, ignoring other properties", async () => {
    await loadPages(db, log, dump("page.sql.gz", ["INSERT INTO `page` VALUES", pageRow(12, "Mercury")]));
    const file = dump("props.sql.gz", [
      "INSERT INTO `page_props` VALUES",
      "(12,'toc','',NULL),",
      "(12,'wikibase_item','Q925',NULL),",
      "(12,'wikibase-shortdesc','Planet\\'s description',NULL),",
      "(12,'disambiguation','',NULL),",
      "(99,'wikibase_item','Q1',NULL);",
    ]);
    await loadProps(db, log, file);
    expect(db.prepare("SELECT qid, description, disambiguation FROM catalogue").get()).toEqual({ qid: "Q925", description: "Planet's description", disambiguation: 1 });
  });

  it("aggregates the clickstream and keeps edges only around recommended articles", async () => {
    await loadPages(db, log, dump("page.sql.gz", ["INSERT INTO `page` VALUES", pageRow(1, "Great_Stink"), pageRow(2, "Sewage"), pageRow(3, "Other")]));
    db.prepare("INSERT INTO targets (page_id) VALUES (1)").run();
    const file = dump("click.tsv.gz", [
      "other-search\tGreat_Stink\texternal\t800",
      "other-internal\tGreat_Stink\texternal\t100",
      "Sewage\tGreat_Stink\tlink\t100",
      "Great_Stink\tSewage\tlink\t50",
      "Sewage\tOther\tlink\t500",
      "Great_Stink\tOther\tlink\t5",
    ]);
    await loadClickstream(db, "2026-10", log, file);
    expect(db.prepare("SELECT monthly_clicks, external_share, inbound_pages FROM catalogue WHERE page_id = 1").get()).toEqual({ monthly_clicks: 1000, external_share: 0.8, inbound_pages: 1 });
    expect(db.prepare("SELECT from_page, to_page, clicks FROM edges ORDER BY from_page").all()).toEqual([
      { from_page: 1, to_page: 2, clicks: 50 },
      { from_page: 2, to_page: 1, clicks: 100 },
    ]);
  });
});

describe("enrichWikidata", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads instance-of labels, whatever type other properties hold", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikihole-wikidata-"));
    const db = openCatalogue(path.join(dir, "catalogue.db"));
    db.prepare("INSERT INTO catalogue (page_id, title, bytes, qid, sources) VALUES (1, 'Curta', 100, 'Q1', 'target people')").run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        const entities =
          url.searchParams.get("props") === "claims"
            ? { Q1: { claims: { P646: [{ mainsnak: { datavalue: { value: "/m/0abc" } } }], P31: [{ mainsnak: { datavalue: { value: { id: "Q2" } } } }] } } }
            : { Q2: { labels: { en: { value: "calculator" } } } };
        return new Response(JSON.stringify({ entities }), { status: 200 });
      }),
    );
    expect(await enrichWikidata(db, { log: () => {} })).toBe(1);
    expect(db.prepare("SELECT instance_of FROM catalogue WHERE page_id = 1").get()).toEqual({ instance_of: '["calculator"]' });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
