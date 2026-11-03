import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { seed, stats } from "../support/fake-wikipedia";

vi.mock("@/lib/wikipedia/api", async () => (await import("../support/fake-wikipedia")).api);
vi.mock("@/lib/article", async () => (await import("../support/fake-wikipedia")).article);

/** Fake Hacker News: list contents and items are mutable per test. */
const hn = {
  lists: {} as Record<string, number[]>,
  items: {} as Record<number, unknown>,
  down: false,
};

function stubHackerNews() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (hn.down) return new Response("unavailable", { status: 503 });
      const path = new URL(input).pathname.replace(/^\/v0\//, "");
      const list = /^(\w+)stories\.json$/.exec(path)?.[1];
      if (list) return Response.json(hn.lists[list] ?? []);
      const id = Number(/^item\/(\d+)\.json$/.exec(path)?.[1]);
      return Response.json(hn.items[id] ?? null);
    }),
  );
}

const story = (id: number, title: string, extra: Record<string, unknown> = {}) => ({ id, type: "story", by: "author", time: 1_761_800_000, title, url: `https://example.org/${id}`, score: 50, descendants: 10, kids: [], ...extra });

async function freshService() {
  vi.resetModules();
  const service = await import("@/lib/hackernews/service");
  const client = await import("@/lib/hackernews/client");
  client.__clearHackerNewsCaches();
  return service;
}

const noSchedule = () => {};

beforeEach(() => {
  seed();
  hn.down = false;
  hn.lists = { top: [1, 2, 3, 4, 5], best: [1], show: [], ask: [3], new: [] };
  hn.items = {
    1: story(1, "Raft: how consensus and leader election work", { score: 40 }),
    2: story(2, "Acme Corp is hiring senior engineers", { type: "job" }),
    3: story(3, "Ask HN: How do you deal with burnout at your job? Should I quit?", { url: undefined, text: "Career advice wanted." }),
    4: story(4, "Some thoughts on florbnitz quux", { score: 3000 }),
    // Resolves to two articles, but neither can be expanded: analysed, then kept out as too thin.
    5: story(5, "Rust’s memory safety guarantees, explained", { score: 2500 }),
  };
  stubHackerNews();
});

afterEach(() => vi.useRealTimers());

describe("Hacker News discovery service", () => {
  it("ingests real submissions, filters low-value ones and serves completed rabbit holes only", async () => {
    const { getHackerNewsFeed } = await freshService();
    const feed = await getHackerNewsFeed({ warmup: 4, schedule: noSchedule });
    expect(feed.items.map((i) => i.submission.id)).toEqual([1]);
    const item = feed.items[0];
    expect(item.primary?.title).toBe("Raft (algorithm)");
    expect(item.articleCount).toBeGreaterThanOrEqual(6);
    expect(item.submission.hnUrl).toBe("https://news.ycombinator.com/item?id=1");
    expect(item.submission.lists.sort()).toEqual(["best", "top"]);
    // Jobs never enter the store. The career question and the popular post with nothing to look up
    // are filtered before any Wikipedia work; the thin Rust hole is analysed but kept out of the feed.
    expect(feed.rejected).toBe(2);
    expect(feed.insufficient).toBe(1);
    expect(feed.pending).toBe(0);
  });

  it("does not reprocess submissions it has seen, but refreshes their metadata", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { getHackerNewsFeed } = await freshService();
    await getHackerNewsFeed({ warmup: 4, schedule: noSchedule });
    const loads = stats.documentLoads;

    (hn.items[1] as { score: number }).score = 999;
    const client = await import("@/lib/hackernews/client");
    client.__clearHackerNewsCaches();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    await getHackerNewsFeed({ warmup: 4, schedule: noSchedule }); // triggers a background refresh
    await new Promise((r) => setTimeout(r, 50));
    const feed = await getHackerNewsFeed({ warmup: 4, schedule: noSchedule });
    expect(stats.documentLoads).toBe(loads);
    expect(feed.items[0].submission.score).toBe(999);
  });

  it("paginates and filters by list", async () => {
    const { getHackerNewsFeed } = await freshService();
    await getHackerNewsFeed({ warmup: 4, schedule: noSchedule });
    expect((await getHackerNewsFeed({ category: "ask", warmup: 0, schedule: noSchedule })).items).toEqual([]);
    const page = await getHackerNewsFeed({ category: "best", limit: 1, warmup: 0, schedule: noSchedule });
    expect(page.items).toHaveLength(1);
    expect(page.nextOffset).toBeNull();
  });

  it("reports Hacker News outages as typed errors when nothing is stored", async () => {
    hn.down = true;
    const { getHackerNewsFeed } = await freshService();
    await expect(getHackerNewsFeed({ schedule: noSchedule })).rejects.toMatchObject({ name: "HackerNewsError" });
  });

  it("keeps a failed build for retry instead of showing it", async () => {
    const { getHackerNewsFeed, getExploration } = await freshService();
    stats.fail = true;
    const feed = await getHackerNewsFeed({ warmup: 4, schedule: noSchedule });
    expect(feed.items).toEqual([]);
    expect(feed.pending).toBeGreaterThan(0);
    const result = await getExploration(1);
    expect(result.status).toBe("failed");
  });

  it("requeues builds interrupted by Wikipedia rate limiting without using a retry", async () => {
    const { getHackerNewsFeed, getExploration } = await freshService();
    stats.rateLimited = true;
    const feed = await getHackerNewsFeed({ warmup: 4, schedule: noSchedule });
    expect(feed.items).toEqual([]);
    expect(feed.pending).toBeGreaterThan(0);
    stats.rateLimited = false;
    // Still pending (not failed), so the next request builds it normally.
    const result = await getExploration(1);
    expect(result.status).toBe("complete");
  });

  it("paces background builds: one at a time, at least 30 seconds apart", async () => {
    const { getHackerNewsFeed, processBackground } = await freshService();
    await getHackerNewsFeed({ warmup: 0, schedule: noSchedule });
    expect(await processBackground()).toBe(1);
    // Immediately after a background build, the next one waits for the spacing.
    expect(await processBackground()).toBe(0);
  });

  it("builds explorations on demand for any story id and explains rejections", async () => {
    hn.items[50] = story(50, "Raft consensus explained");
    const { getExploration } = await freshService();
    const built = await getExploration(50);
    expect(built.status).toBe("complete");
    if (built.status === "complete") expect(built.exploration.nodes.length).toBeGreaterThan(6);
    expect((await getExploration(2)).status).toBe("rejected");
    expect(await getExploration(424242)).toEqual({ status: "notfound" });
    hn.items[60] = { id: 60, type: "story", deleted: true };
    expect(await getExploration(60)).toMatchObject({ status: "rejected", reason: "deleted" });
  });
});

describe("Hacker News routes", () => {
  const get = (url: string, ip = `10.1.0.${Math.floor(Math.random() * 250)}`) => new Request(url, { headers: { "x-forwarded-for": ip } });

  it("validates feed queries", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/hackernews/route");
    expect((await GET(get("http://t/api/hackernews?category=gossip"))).status).toBe(400);
    expect((await GET(get("http://t/api/hackernews?limit=500"))).status).toBe(400);
  });

  it("returns a graceful JSON error when Hacker News is down", async () => {
    hn.down = true;
    vi.resetModules();
    const { GET } = await import("@/app/api/hackernews/route");
    const res = await GET(get("http://t/api/hackernews"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Hacker News/);
    expect(JSON.stringify(body)).not.toMatch(/stack|at fetch/i);
  });

  it("serves the feed", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/hackernews/route");
    const res = await GET(get("http://t/api/hackernews?category=all"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBeGreaterThanOrEqual(0);
  });

  it("validates item ids and maps missing items to 404", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/hackernews/[id]/route");
    const params = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await GET(get("http://t/api/hackernews/abc"), params("abc"))).status).toBe(400);
    expect((await GET(get("http://t/api/hackernews/999999"), params("999999"))).status).toBe(404);
    const ok = await GET(get("http://t/api/hackernews/1"), params("1"));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe("complete");
  });
});

describe("persistent storage", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wikihole-test-"));
    vi.stubEnv("WIKIHOLE_DATA_DIR", dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  const schema = z.object({ count: z.number() });

  it("writes atomically and reads the document back in a new process", async () => {
    vi.resetModules();
    const { createDocumentStore } = await import("@/lib/server/persistence");
    const store = createDocumentStore("test", schema, () => ({ count: 0 }));
    expect(await store.read()).toEqual({ count: 0 });
    store.write({ count: 3 });
    await store.flush();
    expect(JSON.parse(await readFile(join(dir, "test.json"), "utf8"))).toEqual({ count: 3 });
    const again = createDocumentStore("test", schema, () => ({ count: 0 }));
    expect(await again.read()).toEqual({ count: 3 });
  });

  it("ignores corrupted or foreign data and falls back", async () => {
    await writeFile(join(dir, "test.json"), "{not json", "utf8");
    vi.resetModules();
    const { createDocumentStore } = await import("@/lib/server/persistence");
    expect(await createDocumentStore("test", schema, () => ({ count: 7 })).read()).toEqual({ count: 7 });
    await writeFile(join(dir, "test.json"), JSON.stringify({ count: "three" }), "utf8");
    expect(await createDocumentStore("test", schema, () => ({ count: 8 })).read()).toEqual({ count: 8 });
  });

  it("keeps processed rabbit holes across restarts", async () => {
    const first = await freshService();
    await first.getHackerNewsFeed({ warmup: 4, schedule: noSchedule });
    await first.__flushHackerNewsStore();
    const loads = stats.documentLoads;
    const second = await freshService();
    const feed = await second.getHackerNewsFeed({ warmup: 4, schedule: noSchedule });
    expect(feed.items.map((i) => i.submission.id)).toEqual([1]);
    expect(stats.documentLoads).toBe(loads);
  });

  it("can run in memory only", async () => {
    vi.stubEnv("WIKIHOLE_DATA_DIR", ":memory:");
    vi.resetModules();
    const { createDocumentStore } = await import("@/lib/server/persistence");
    const store = createDocumentStore("test", schema, () => ({ count: 1 }));
    store.write({ count: 2 });
    await store.flush();
    expect(store.location()).toBe("memory");
    expect(await store.read()).toEqual({ count: 2 });
  });
});
