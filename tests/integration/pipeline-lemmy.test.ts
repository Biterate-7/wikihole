import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getState, openHuman, type Db } from "../../pipeline/db";
import { fetchJson } from "../../pipeline/http";
import { ingestLemmy } from "../../pipeline/sources/lemmy";

/** Pagination against a stubbed Lemmy that, like lemmy.world, refuses pages past a limit. */

const day = (n: number) => new Date(Date.UTC(2024, 0, n)).toISOString();

function post(id: number, published: string) {
  return {
    post: { id, name: `Article ${id}`, url: `https://en.wikipedia.org/wiki/Article_${id}`, published, ap_id: `https://lemmy.world/post/${id}` },
    creator: { actor_id: `https://lemmy.world/u/person${id}` },
    counts: { score: 5, comments: 0 },
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("pipeline http", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries when the body fails to arrive after the headers did", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls > 1) return json({ ok: true });
        return new Response(new ReadableStream({ start: (controller) => controller.error(new DOMException("timed out", "TimeoutError")) }));
      }),
    );
    await expect(fetchJson("https://body-retry.test/a", { gapMs: 0 })).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  }, 15_000);
});

describe("ingestLemmy", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "wikihole-lemmy-"));
    db = openHuman(path.join(dir, "human.db"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reaches posts beyond the page limit by walking oldest first, then stops", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n");
        const sort = url.searchParams.get("sort");
        const page = Number(url.searchParams.get("page"));
        requested.push(`${sort}:${page}`);
        if (sort === "New") {
          if (page > 2) return new Response("couldnt_get_posts", { status: 400 });
          return json({ posts: page === 1 ? [post(6, day(6)), post(5, day(5))] : [post(4, day(4)), post(3, day(3))] });
        }
        return json({ posts: page === 1 ? [post(1, day(1)), post(2, day(2))] : [post(3, day(3)), post(4, day(4))] });
      }),
    );

    await ingestLemmy(db, { maxPage: 2, minGapMs: 0 });

    expect(requested).toEqual(["New:1", "New:2", "Old:1", "Old:2"]);
    const rows = db.prepare("SELECT raw_title FROM mentions WHERE source = 'lemmy' ORDER BY created_at").all() as Array<{ raw_title: string }>;
    expect(rows.map((row) => row.raw_title)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Article ${n}`));
    expect(getState(db, "lemmy:complete")).toBeTruthy();
    expect(getState(db, "lemmy:sort")).toBe("New");
    expect(getState(db, "lemmy:page")).toBe("1");
  });

  it("resumes the oldest-first walk from its saved page", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n");
        requested.push(`${url.searchParams.get("sort")}:${url.searchParams.get("page")}`);
        return json({ posts: [post(1, day(1))] });
      }),
    );
    await ingestLemmy(db, { maxPage: 1, maxPages: 2, minGapMs: 0 });
    await ingestLemmy(db, { maxPage: 1, maxPages: 1, minGapMs: 0 });
    expect(requested[0]).toBe("New:1");
    expect(requested[1]).toBe("Old:1");
    expect(requested[2]).toMatch(/^Old:|^New:1$/);
  });
});
