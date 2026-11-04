import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyReviews, classifyPending } from "../../pipeline/classify/run";
import { openDb, type Db } from "../../pipeline/db";
import { resolveTitles } from "../../pipeline/resolve";
import { ingestHackerNews } from "../../pipeline/sources/hackernews";
import { updateStats } from "../../pipeline/stats";

/** The pipeline against a scratch store and mocked sources: nothing touches the network. */

let dir: string;
let db: Db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikihole-pipeline-"));
  db = openDb(path.join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const comment = (id: number, at: number, title: string, text = "Worth reading:") => ({
  objectID: String(id),
  created_at_i: at,
  author: `user${id}`,
  comment_text: `${text} <a href="https://en.wikipedia.org/wiki/${title}" rel="nofollow">x</a>`,
  story_id: id + 1000,
  story_title: "A thread",
});

/** Serves hits the way search_by_date does: newest first, honouring the numeric filters. */
function fakeAlgolia(hits: Array<{ created_at_i: number }>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const filters = url.searchParams.get("numericFilters") ?? "";
    const before = /created_at_i<=(\d+)/.exec(filters)?.[1];
    const after = /created_at_i>(\d+)/.exec(filters)?.[1];
    const matching = hits
      .filter((hit) => (!before || hit.created_at_i <= Number(before)) && (!after || hit.created_at_i > Number(after)))
      .sort((a, b) => b.created_at_i - a.created_at_i);
    return new Response(JSON.stringify({ hits: matching.slice(0, Number(url.searchParams.get("hitsPerPage"))) }));
  });
}

const mentionCount = () => (db.prepare("SELECT count(*) AS n FROM mentions").get() as { n: number }).n;

describe("Hacker News ingestion", () => {
  it("walks to the end, then a later run fetches only what is new", async () => {
    const hits = [comment(1, 1000, "Alpha"), comment(2, 2000, "Beta")];
    vi.stubGlobal("fetch", fakeAlgolia(hits));
    await ingestHackerNews(db, "comment");
    expect(mentionCount()).toBe(2);

    const stored = db.prepare("SELECT item_url, discussion_url, author_hash FROM mentions WHERE raw_title = 'Beta'").get() as Record<string, string>;
    expect(stored.item_url).toBe("https://news.ycombinator.com/item?id=2");
    expect(stored.discussion_url).toBe("https://news.ycombinator.com/item?id=1002");
    expect(stored.author_hash).not.toContain("user");

    const newer = fakeAlgolia([...hits, comment(3, 3000, "Gamma")]);
    vi.stubGlobal("fetch", newer);
    const second = await ingestHackerNews(db, "comment");
    expect(second.items).toBe(1);
    expect(mentionCount()).toBe(3);
  });

  it("resumes an interrupted walk without losing or repeating anything", async () => {
    const hits = [comment(1, 1000, "Alpha"), comment(2, 2000, "Beta"), comment(3, 3000, "Gamma")];
    vi.stubGlobal("fetch", fakeAlgolia(hits));
    await ingestHackerNews(db, "comment", { maxPages: 1 });
    await ingestHackerNews(db, "comment");
    expect(mentionCount()).toBe(3);
  });

  it("is idempotent, and never stores a username", async () => {
    const hits = [comment(1, 1000, "Alpha")];
    vi.stubGlobal("fetch", fakeAlgolia(hits));
    await ingestHackerNews(db, "comment");
    db.prepare("DELETE FROM state WHERE key LIKE 'hn:%'").run();
    await ingestHackerNews(db, "comment");
    expect(mentionCount()).toBe(1);
    const row = JSON.stringify(db.prepare("SELECT * FROM mentions").get());
    expect(row).not.toContain("user1");
  });

  it("surfaces repeated failure instead of inventing data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    await expect(ingestHackerNews(db, "comment")).rejects.toThrow(/403/);
    expect(mentionCount()).toBe(0);
  });
});

describe("resolution, classification and statistics", () => {
  const seed = async (hits: ReturnType<typeof comment>[]) => {
    vi.stubGlobal("fetch", fakeAlgolia(hits));
    await ingestHackerNews(db, "comment");
  };

  const wikipedia = (handler: (titles: string[]) => unknown) =>
    vi.fn(async (input: string | URL | Request) => {
      const titles = new URL(String(input)).searchParams.get("titles")!.split("|");
      return new Response(JSON.stringify(handler(titles)));
    });

  it("merges redirects into one article and records missing pages", async () => {
    await seed([comment(1, 1000, "Alias"), comment(2, 2000, "Canonical"), comment(3, 3000, "Gone")]);
    vi.stubGlobal(
      "fetch",
      wikipedia(() => ({
        query: {
          redirects: [{ from: "Alias", to: "Canonical" }],
          pages: [
            { pageid: 42, ns: 0, title: "Canonical" },
            { ns: 0, title: "Gone", missing: true },
          ],
        },
      })),
    );
    expect(await resolveTitles(db)).toBe(3);
    classifyPending(db);
    expect(updateStats(db)).toBe(1);
    const stats = db.prepare("SELECT * FROM article_stats").all() as Array<Record<string, unknown>>;
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ page_id: 42, title: "Canonical", qualifying: 2, discussions: 2, recommenders: 2 });
    const gone = db.prepare("SELECT status, page_id FROM titles WHERE raw_title = 'Gone'").get() as Record<string, unknown>;
    expect(gone).toEqual({ status: "missing", page_id: null });
  });

  it("recomputes only articles whose mentions changed", async () => {
    await seed([comment(1, 1000, "Alpha"), comment(2, 2000, "Beta")]);
    vi.stubGlobal(
      "fetch",
      wikipedia((titles) => ({ query: { pages: titles.map((title, i) => ({ pageid: 100 + i, ns: 0, title })) } })),
    );
    await resolveTitles(db);
    classifyPending(db);
    expect(updateStats(db)).toBe(2);
    expect(updateStats(db)).toBe(0);

    await seed([comment(1, 1000, "Alpha"), comment(2, 2000, "Beta"), comment(3, 3000, "Beta")]);
    classifyPending(db);
    expect(updateStats(db)).toBe(1);
    const beta = db.prepare("SELECT qualifying FROM article_stats WHERE title = 'Beta'").get() as { qualifying: number };
    expect(beta.qualifying).toBe(2);
  });

  it("does not count a link as a recommendation", async () => {
    await seed([comment(1, 1000, "Alpha", "According to")]);
    vi.stubGlobal("fetch", wikipedia((titles) => ({ query: { pages: titles.map((title) => ({ pageid: 7, ns: 0, title })) } })));
    await resolveTitles(db);
    classifyPending(db);
    updateStats(db);
    expect(db.prepare("SELECT count(*) AS n FROM article_stats").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT label FROM mentions").get()).toEqual({ label: "citation" });
  });

  it("keeps stored labels when reviews apply on top, and a review wins", async () => {
    await seed([comment(1, 1000, "Alpha")]);
    vi.stubGlobal("fetch", wikipedia((titles) => ({ query: { pages: titles.map((title) => ({ pageid: 7, ns: 0, title })) } })));
    await resolveTitles(db);
    classifyPending(db);
    updateStats(db);
    expect(db.prepare("SELECT qualifying FROM article_stats").get()).toEqual({ qualifying: 1 });

    db.prepare("UPDATE mentions SET review = 'casual'").run();
    db.prepare("INSERT OR IGNORE INTO dirty_titles SELECT lang, raw_title FROM mentions").run();
    updateStats(db);
    expect(db.prepare("SELECT count(*) AS n FROM article_stats").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT label, review FROM mentions").get()).toEqual({ label: "recommendation", review: "casual" });
    expect(applyReviews(db)).toBeGreaterThanOrEqual(0);
  });
});
