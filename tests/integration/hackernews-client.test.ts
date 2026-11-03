import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearHackerNewsCaches, getItem, getItems, getStoryIds, HackerNewsError } from "@/lib/hackernews/client";
import { discoverSubmissions, topComments } from "@/lib/hackernews/ingestion";
import { submission } from "../support/hn";

/** A fake Hacker News Firebase API: lists and items keyed by path. */
type Reply = unknown | ((attempt: number) => Response);

function serve(routes: Record<string, Reply>) {
  const attempts = new Map<string, number>();
  const fetchMock = vi.fn(async (input: string) => {
    const path = new URL(input).pathname.replace(/^\/v0/, "");
    const n = (attempts.get(path) ?? 0) + 1;
    attempts.set(path, n);
    if (!(path in routes)) return new Response("null", { status: 200 });
    const reply = routes[path];
    if (typeof reply === "function") return (reply as (attempt: number) => Response)(n);
    return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const story = (id: number, extra: Record<string, unknown> = {}) => ({ id, type: "story", by: "user", time: 1_761_000_000, title: `Story ${id}`, url: `https://example.org/${id}`, score: 10 * id, descendants: id, kids: [], ...extra });

beforeEach(() => __clearHackerNewsCaches());

describe("Hacker News API client", () => {
  it("fetches top, best, new, Ask HN and Show HN lists", async () => {
    const fetchMock = serve({
      "/topstories.json": [1, 2, 3],
      "/beststories.json": [3, 4],
      "/newstories.json": [5],
      "/askstories.json": [6],
      "/showstories.json": [7],
    });
    expect(await getStoryIds("top")).toEqual([1, 2, 3]);
    expect(await getStoryIds("best")).toEqual([3, 4]);
    expect(await getStoryIds("new")).toEqual([5]);
    expect(await getStoryIds("ask")).toEqual([6]);
    expect(await getStoryIds("show")).toEqual([7]);
    // Cached: a second read does not refetch.
    await getStoryIds("top");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://hacker-news.firebaseio.com/v0/topstories.json");
  });

  it("fetches item metadata and reports missing and deleted items", async () => {
    serve({ "/item/1.json": story(1), "/item/2.json": { id: 2, deleted: true, type: "story" } });
    expect(await getItem(1)).toMatchObject({ id: 1, title: "Story 1", score: 10 });
    expect(await getItem(2)).toMatchObject({ id: 2, deleted: true });
    expect(await getItem(999)).toBeNull();
  });

  it("retries transient failures with backoff, then succeeds", async () => {
    serve({ "/item/5.json": (n: number) => (n < 2 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify(story(5)))) });
    expect(await getItem(5)).toMatchObject({ id: 5 });
  });

  it("surfaces persistent failures and malformed data as typed errors", async () => {
    serve({ "/topstories.json": () => new Response("down", { status: 500 }), "/beststories.json": { not: "a list" } });
    await expect(getStoryIds("top")).rejects.toMatchObject({ kind: "http", status: 500 });
    await expect(getStoryIds("best")).rejects.toBeInstanceOf(HackerNewsError);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    await expect(getItem(77)).rejects.toMatchObject({ kind: "network" });
  });

  it("keeps a batch alive when single items fail", async () => {
    serve({ "/item/1.json": story(1), "/item/2.json": () => new Response("bad", { status: 404 }) });
    const { items, failed } = await getItems([1, 2, 1]);
    expect(items.map((i) => i.id)).toEqual([1]);
    expect(failed).toEqual([2]);
  });
});

describe("ingestion", () => {
  it("de-duplicates submissions across lists, keeps their list membership, and drops unusable items", async () => {
    serve({
      "/topstories.json": [1, 2, 3, 4],
      "/beststories.json": [2],
      "/showstories.json": [3],
      "/askstories.json": [5],
      "/newstories.json": () => new Response("down", { status: 500 }),
      "/item/1.json": story(1, { title: "Show HN: Thing" }),
      "/item/2.json": story(2),
      "/item/3.json": story(3, { dead: true }),
      "/item/4.json": { id: 4, type: "job", title: "Hiring" },
      "/item/5.json": story(5, { url: undefined, text: "<p>Body</p>", title: "Ask HN: Question?" }),
    });
    const { submissions, failedLists } = await discoverSubmissions();
    expect(failedLists).toEqual(["new"]);
    expect(submissions.map((s) => s.id).sort()).toEqual([1, 2, 5]);
    expect(submissions.find((s) => s.id === 2)?.lists.sort()).toEqual(["best", "top"]);
    const ask = submissions.find((s) => s.id === 5)!;
    expect(ask).toMatchObject({ category: "ask", text: "Body", hnUrl: "https://news.ycombinator.com/item?id=5" });
    expect(ask.url).toBeUndefined();
  });

  it("fails loudly only when every list fails", async () => {
    serve({
      "/topstories.json": () => new Response("x", { status: 500 }),
      "/beststories.json": () => new Response("x", { status: 500 }),
      "/showstories.json": () => new Response("x", { status: 500 }),
      "/askstories.json": () => new Response("x", { status: 500 }),
      "/newstories.json": () => new Response("x", { status: 500 }),
    });
    await expect(discoverSubmissions()).rejects.toBeInstanceOf(HackerNewsError);
  });

  it("reads live top-level comments as plain text and skips deleted ones", async () => {
    serve({
      "/item/10.json": { id: 10, type: "comment", text: "Uses <i>SQLite</i> &amp; WAL" },
      "/item/11.json": { id: 11, type: "comment", deleted: true },
      "/item/12.json": { id: 12, type: "comment", dead: true, text: "spam" },
    });
    const comments = await topComments(submission({ id: 9, kids: [10, 11, 12] }));
    expect(comments).toEqual(["Uses SQLite & WAL"]);
  });
});
