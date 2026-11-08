import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The pipeline keeps two independent working stores (gitignored, rebuildable
 * from sources). Each has its own ingestion, ranking and quality metrics; the
 * only thing they share is Wikipedia's page id.
 *
 *   human.db      what people said, with provenance, and what it counts for
 *   catalogue.db  what Wikipedia contains, whoever talks about it
 */

export const WORK_DIR = path.resolve(process.env.WIKIHOLE_WORK_DIR ?? "data/work");

const STATE = "CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);";

const HUMAN_SCHEMA = `
${STATE}
CREATE TABLE IF NOT EXISTS mentions (
  id TEXT PRIMARY KEY,              -- source:item:lang:title, so re-ingesting is idempotent
  source TEXT NOT NULL,             -- platform, e.g. lemmy
  community TEXT NOT NULL,          -- community within it, e.g. "Tildes ~science"
  kind TEXT NOT NULL,               -- comment | submission | essay
  item_url TEXT NOT NULL,           -- the exact comment, post or page
  discussion_id TEXT NOT NULL,      -- groups items from one thread
  discussion_url TEXT NOT NULL,
  discussion_title TEXT,
  author_hash TEXT,                 -- keyed hash; usernames are never stored
  created_at INTEGER NOT NULL,
  points INTEGER,
  replies INTEGER,
  lang TEXT NOT NULL,
  raw_title TEXT NOT NULL,
  raw_url_fragment TEXT,
  context TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  links_in_text INTEGER NOT NULL,
  words_in_text INTEGER NOT NULL,
  label TEXT,                       -- the rules' verdict: recommendation | interesting | citation | casual | criticism | spam
  confidence REAL,
  reason TEXT,
  classifier TEXT,
  review TEXT                       -- a reviewed label, which outranks everything
);
CREATE INDEX IF NOT EXISTS mentions_title ON mentions (lang, raw_title);
CREATE INDEX IF NOT EXISTS mentions_label ON mentions (label);
CREATE INDEX IF NOT EXISTS mentions_created ON mentions (created_at);

CREATE TABLE IF NOT EXISTS titles (
  lang TEXT NOT NULL,
  raw_title TEXT NOT NULL,
  page_id INTEGER,                  -- null: missing or not an article
  canonical_title TEXT,
  status TEXT NOT NULL,             -- ok | redirected | missing | not-article | disambiguation
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (lang, raw_title)
);
CREATE INDEX IF NOT EXISTS titles_page ON titles (lang, page_id);

CREATE TABLE IF NOT EXISTS article_stats (
  lang TEXT NOT NULL,
  page_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  qualifying INTEGER NOT NULL,
  discussions INTEGER NOT NULL,
  recommenders INTEGER NOT NULL,
  months INTEGER NOT NULL,
  years INTEGER NOT NULL,
  communities INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  recent_12m INTEGER NOT NULL,
  mentions_other INTEGER NOT NULL,  -- every non-qualifying mention, for transparency
  criticism INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  effective REAL NOT NULL DEFAULT 0,
  in_words INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lang, page_id)
);

CREATE TABLE IF NOT EXISTS dirty_titles (lang TEXT NOT NULL, raw_title TEXT NOT NULL, PRIMARY KEY (lang, raw_title));
`;

/** Columns added after the first stores were created; existing stores gain them on open. */
const HUMAN_COLUMNS: Array<[string, string, string]> = [
  ["mentions", "llm_label", "TEXT"],
  ["mentions", "llm_confidence", "REAL"],
  ["mentions", "llm_reason", "TEXT"],
  ["mentions", "llm_model", "TEXT"],
  ["mentions", "final_label", "TEXT"],
  ["mentions", "final_confidence", "REAL"],
  ["mentions", "decided_by", "TEXT"],
  ["article_stats", "effective", "REAL NOT NULL DEFAULT 0"],
  ["article_stats", "in_words", "INTEGER NOT NULL DEFAULT 0"],
];

const CATALOGUE_SCHEMA = `
${STATE}
CREATE TABLE IF NOT EXISTS catalogue (
  page_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  disambiguation INTEGER NOT NULL DEFAULT 0,
  qid TEXT,
  description TEXT,
  monthly_clicks INTEGER,           -- clickstream: all arrivals in the dump's month
  external_share REAL,              -- share of arrivals from outside Wikipedia
  inbound_pages INTEGER,            -- clickstream: distinct articles readers arrive from
  assessment TEXT,
  topics TEXT,                      -- ORES article topics
  categories TEXT,
  instance_of TEXT,                 -- Wikidata P31 labels
  incoming_links INTEGER,
  last_revision TEXT,
  sources TEXT                      -- why it is in the enriched set
);
CREATE INDEX IF NOT EXISTS catalogue_title ON catalogue (title);
CREATE INDEX IF NOT EXISTS catalogue_clicks ON catalogue (monthly_clicks);

CREATE TABLE IF NOT EXISTS edges (
  from_page INTEGER NOT NULL,
  to_page INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  PRIMARY KEY (from_page, to_page)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edges_to ON edges (to_page);

-- The one link between the stores: page ids another dataset asked to have detailed.
CREATE TABLE IF NOT EXISTS targets (page_id INTEGER PRIMARY KEY);
`;

export type Db = DatabaseSync;

function open(file: string, schema: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA busy_timeout = 60000;");
  db.exec(schema);
  return db;
}

export function openHuman(file = path.join(WORK_DIR, "human.db")): Db {
  const db = open(file, HUMAN_SCHEMA);
  for (const [table, column, type] of HUMAN_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS mentions_final ON mentions (final_label)");
  return db;
}

export function openCatalogue(file = path.join(WORK_DIR, "catalogue.db")): Db {
  return open(file, CATALOGUE_SCHEMA);
}

export function getState(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM state WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setState(db: Db, key: string, value: string | number): void {
  db.prepare("INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

export function transaction<T>(db: Db, run: () => T): T {
  db.exec("BEGIN");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * A keyed hash that lets the pipeline count distinct people without storing who
 * they are. The key stays in the working store and is never exported.
 */
export function authorHasher(db: Db): (source: string, author: string | null | undefined) => string | null {
  let key = getState(db, "author-hash-key");
  if (!key) {
    key = randomBytes(32).toString("hex");
    setState(db, "author-hash-key", key);
  }
  const secret = key;
  return (source, author) => (author ? createHmac("sha256", secret).update(`${source}:${author}`).digest("base64url").slice(0, 22) : null);
}
