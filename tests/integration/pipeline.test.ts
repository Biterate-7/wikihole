import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLabels, classifyPending, decideAll, measureCalibration } from "../../pipeline/classify/run";
import type { Calibration } from "../../pipeline/classify/decide";
import { authorHasher, openHuman, type Db } from "../../pipeline/db";
import { resolveTitles } from "../../pipeline/resolve";
import { saveMentions } from "../../pipeline/sources/store";
import { onePerItem, updateStats } from "../../pipeline/stats";
import { extractLinks } from "../../pipeline/text";

/** The pipeline against a scratch store and mocked sources: nothing touches the network. */

let dir: string;
let db: Db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikihole-pipeline-"));
  db = openHuman(path.join(dir, "test.db"));
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const comment = (id: number, at: number, title: string, text = "Worth reading:") => ({
  id,
  at,
  html: `${text} <a href="https://en.wikipedia.org/wiki/${title}" rel="nofollow">x</a>`,
});

/** A rule measured as reliable, so its verdicts count without waiting for review. */
const TRUSTED: Calibration = { "comment|says it is worth reading": { checked: 50, confirmed: 49, precision: 0.96 } };
const classify = () => {
  classifyPending(db);
  decideAll(db, TRUSTED);
};

describe("resolution, classification and statistics", () => {
  const seed = (comments: ReturnType<typeof comment>[]) => {
    const hash = authorHasher(db);
    for (const { id, at, html } of comments) {
      saveMentions(
        db,
        {
          source: "forum",
          community: "Test forum",
          kind: "comment",
          itemId: String(id),
          itemUrl: `https://example.test/item/${id}`,
          discussionId: `forum:${id + 1000}`,
          discussionUrl: `https://example.test/item/${id + 1000}`,
          discussionTitle: "A thread",
          authorHash: hash("forum", `user${id}`),
          createdAt: at,
          points: null,
          replies: null,
        },
        extractLinks(html),
      );
    }
  };

  const wikipedia = (handler: (titles: string[]) => unknown) =>
    vi.fn(async (input: string | URL | Request) => {
      const titles = new URL(String(input)).searchParams.get("titles")!.split("|");
      return new Response(JSON.stringify(handler(titles)));
    });

  it("merges redirects into one article and records missing pages", async () => {
    seed([comment(1, 1000, "Alias"), comment(2, 2000, "Canonical"), comment(3, 3000, "Gone")]);
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
    classify();
    expect(updateStats(db)).toBe(1);
    const stats = db.prepare("SELECT * FROM article_stats").all() as Array<Record<string, unknown>>;
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ page_id: 42, title: "Canonical", qualifying: 2, discussions: 2, recommenders: 2 });
    const gone = db.prepare("SELECT status, page_id FROM titles WHERE raw_title = 'Gone'").get() as Record<string, unknown>;
    expect(gone).toEqual({ status: "missing", page_id: null });
  });

  it("counts one post linking an article and its redirect once", () => {
    const rows = [
      { item_url: "https://example.test/1", title: "Canonical" },
      { item_url: "https://example.test/1", title: "Alias" },
      { item_url: "https://example.test/2", title: "Canonical" },
    ];
    expect(onePerItem(rows).map((row) => row.title)).toEqual(["Canonical", "Canonical"]);
  });

  it("recomputes only articles whose mentions changed", async () => {
    seed([comment(1, 1000, "Alpha"), comment(2, 2000, "Beta")]);
    vi.stubGlobal(
      "fetch",
      wikipedia((titles) => ({ query: { pages: titles.map((title, i) => ({ pageid: 100 + i, ns: 0, title })) } })),
    );
    await resolveTitles(db);
    classify();
    expect(updateStats(db)).toBe(2);
    expect(updateStats(db)).toBe(0);

    seed([comment(1, 1000, "Alpha"), comment(2, 2000, "Beta"), comment(3, 3000, "Beta")]);
    classify();
    expect(updateStats(db)).toBe(1);
    const beta = db.prepare("SELECT qualifying FROM article_stats WHERE title = 'Beta'").get() as { qualifying: number };
    expect(beta.qualifying).toBe(2);
  });

  it("does not count a link as a recommendation", async () => {
    seed([comment(1, 1000, "Alpha", "According to")]);
    vi.stubGlobal("fetch", wikipedia((titles) => ({ query: { pages: titles.map((title) => ({ pageid: 7, ns: 0, title })) } })));
    await resolveTitles(db);
    classify();
    updateStats(db);
    expect(db.prepare("SELECT count(*) AS n FROM article_stats").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT label FROM mentions").get()).toEqual({ label: "citation" });
  });

  it("does not count a rule with no measured precision until something reviews it", async () => {
    seed([comment(1, 1000, "Alpha")]);
    vi.stubGlobal("fetch", wikipedia((titles) => ({ query: { pages: titles.map((title) => ({ pageid: 7, ns: 0, title })) } })));
    await resolveTitles(db);
    classifyPending(db);
    decideAll(db, {});
    updateStats(db);
    expect(db.prepare("SELECT final_label FROM mentions").get()).toEqual({ final_label: "needs-review" });
    expect(db.prepare("SELECT count(*) AS n FROM article_stats").get()).toEqual({ n: 0 });

    db.prepare("UPDATE mentions SET llm_label = 'recommendation', llm_confidence = 0.9, llm_model = 'claude-test'").run();
    decideAll(db, {});
    updateStats(db);
    expect(db.prepare("SELECT final_label, decided_by FROM mentions").get()).toEqual({ final_label: "recommendation", decided_by: "claude-test" });
    expect(db.prepare("SELECT qualifying, in_words FROM article_stats").get()).toEqual({ qualifying: 1, in_words: 1 });
  });

  it("applies label files, and keeps held-out rows out of calibration", () => {
    const row = "INSERT INTO mentions (id, source, community, kind, item_url, discussion_id, discussion_url, created_at, lang, raw_title, context, excerpt, links_in_text, words_in_text, label, reason) VALUES (?, 'x', 'x', 'comment', 'u', 'd', 'u', 1, 'en', ?, 'c', 'e', 1, 1, 'recommendation', 'r')";
    db.prepare(row).run("a", "A");
    db.prepare(row).run("b", "B");
    db.prepare(row).run("held", "C");
    const reviews = path.join(dir, "reviews.jsonl");
    const evaluation = path.join(dir, "eval.jsonl");
    const llm = path.join(dir, "llm.jsonl");
    fs.writeFileSync(reviews, '{"id":"a","label":"recommendation","reviewer":"x"}\n');
    fs.writeFileSync(evaluation, '{"id":"held","label":"citation","reviewer":"x"}\n');
    fs.writeFileSync(llm, '{"id":"b","label":"citation","confidence":0.9,"why":"","model":"claude-test"}\n');
    expect(applyLabels(db, { reviews, evaluation, llm })).toEqual({ reviews: 2, llm: 1 });
    const calibration = measureCalibration(db, new Set(["held"]));
    expect(calibration["comment|r"]).toMatchObject({ checked: 2, confirmed: 1 });
  });

  it("keeps stored labels when reviews apply on top, and a review wins", async () => {
    seed([comment(1, 1000, "Alpha")]);
    vi.stubGlobal("fetch", wikipedia((titles) => ({ query: { pages: titles.map((title) => ({ pageid: 7, ns: 0, title })) } })));
    await resolveTitles(db);
    classify();
    updateStats(db);
    expect(db.prepare("SELECT qualifying FROM article_stats").get()).toEqual({ qualifying: 1 });

    db.prepare("UPDATE mentions SET review = 'casual'").run();
    decideAll(db, TRUSTED);
    updateStats(db);
    expect(db.prepare("SELECT count(*) AS n FROM article_stats").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT label, review, final_label, decided_by FROM mentions").get()).toEqual({ label: "recommendation", review: "casual", final_label: "casual", decided_by: "review" });
  });
});
