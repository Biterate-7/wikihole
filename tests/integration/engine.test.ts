import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageMeta, SearchHit } from "@/lib/wikipedia/types";
import { parseArticle } from "@/lib/content/parse";
import { WikipediaError } from "@/lib/wikipedia/http";
import { meta } from "../support/meta";
import { loadParseFixture } from "../support/fixtures";

/**
 * The discovery engine is tested against a fake Wikipedia: each category
 * query returns a mix of strong articles and pages the gate must reject.
 */

const state = {
  failSearch: false,
  searches: 0,
};

const universe = new Map<string, PageMeta>();

function seedUniverse() {
  universe.clear();
  let id = 1;
  const add = (m: PageMeta) => universe.set(m.title, { ...m, pageId: id++ });
  for (let i = 0; i < 400; i++) add(meta({ title: `Theorem ${i}`, recentViews: 50 + i * 10 }));
  for (let i = 0; i < 40; i++) add(meta({ title: `Disambiguation ${i}`, disambiguation: true }));
  for (let i = 0; i < 40; i++) add(meta({ title: `Person ${i}`, categories: ["1900 births", "Mathematicians"] }));
  for (let i = 0; i < 40; i++) add(meta({ title: `List of things ${i}` }));
  for (let i = 0; i < 40; i++) add(meta({ title: `Stub ${i}`, length: 2000 }));
}

vi.mock("@/lib/wikipedia/api", () => ({
  searchCandidates: vi.fn(async (query: string, opts: { limit?: number } = {}): Promise<SearchHit[]> => {
    state.searches++;
    if (state.failSearch) throw new WikipediaError("Wikipedia is down", "http", 503);
    const all = [...universe.values()];
    // Deterministic "random" sample per query so tests are stable but subtopics differ.
    // Strided sampling spreads each draw across the whole universe, like a random sort would.
    const offset = (query.length * 37 + state.searches * 53) % all.length;
    const sample = Array.from({ length: Math.min(opts.limit ?? 50, all.length) }, (_, i) => all[(offset + i * 7) % all.length]);
    return sample.map((m) => ({ pageId: m.pageId, title: m.title, size: m.length, wordCount: 3000 }));
  }),
  getPagesMeta: vi.fn(async (titles: string[]) => titles.map((t) => universe.get(t)).filter(Boolean)),
  getPagesMetaMap: vi.fn(async (titles: string[]) => new Map(titles.map((t) => [t, universe.get(t) ?? null]))),
  getRandomTitles: vi.fn(async (n: number) => [...universe.keys()].slice(-n)),
  getMoreLike: vi.fn(async () => [...universe.values()].slice(0, 5).map((m) => ({ pageId: m.pageId, title: m.title, size: m.length, wordCount: 1 }))),
}));

async function freshEngine() {
  vi.resetModules();
  return import("@/lib/discovery/engine");
}

beforeEach(() => {
  seedUniverse();
  state.failSearch = false;
  state.searches = 0;
});

describe("discovery feed", () => {
  it("returns gated, ranked, de-duplicated articles with transparent scores", async () => {
    const { getFeed } = await freshEngine();
    const feed = await getFeed({ limit: 12 });
    expect(feed.items).toHaveLength(12);
    expect(new Set(feed.items.map((i) => i.pageId)).size).toBe(12);
    for (const item of feed.items) {
      expect(item.title).toMatch(/^Theorem/);
      expect(item.extract.length).toBeGreaterThan(50);
      expect(item.url).toBe(`https://en.wikipedia.org/wiki/${item.title.replace(/ /g, "_")}`);
      expect(item.score.total).toBeGreaterThan(0);
      expect(Object.keys(item.score.components)).toHaveLength(6);
    }
    expect(feed.stats.sampled).toBeGreaterThan(0);
    expect(feed.stats.accepted).toBeGreaterThan(0);
  });

  it("never repeats excluded (already seen) articles", async () => {
    const { getFeed } = await freshEngine();
    const first = await getFeed({ limit: 12 });
    const seen = first.items.map((i) => i.pageId);
    const second = await getFeed({ limit: 12, exclude: seen });
    expect(second.items.length).toBeGreaterThan(0);
    for (const item of second.items) expect(seen).not.toContain(item.pageId);
  });

  it("filters by topic and labels items with that subtopic", async () => {
    const { getFeed } = await freshEngine();
    const feed = await getFeed({ topic: "cryptography", limit: 6 });
    expect(feed.topic).toBe("cryptography");
    expect(feed.items.every((i) => i.subtopic === "cryptography")).toBe(true);
  });

  it("rejects low-quality pages and records why", async () => {
    const { getFeed } = await freshEngine();
    const feed = await getFeed({ limit: 30 });
    const titles = feed.items.map((i) => i.title).join(" ");
    expect(titles).not.toMatch(/Disambiguation|Person|List of|Stub/);
    const reasons = Object.keys(feed.stats.rejected);
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("throws a typed error when every source fails (UI shows an error state)", async () => {
    const { getFeed } = await freshEngine();
    state.failSearch = true;
    await expect(getFeed({ limit: 12 })).rejects.toBeInstanceOf(WikipediaError);
  });
});

describe("random discovery", () => {
  it("ranks a uniformly random sample together with topical samples", async () => {
    const { getRandomDiscovery } = await freshEngine();
    const result = await getRandomDiscovery();
    expect(result.discovery).not.toBeNull();
    expect(result.discovery!.title).toMatch(/^Theorem/);
    expect(result.stats.uniformSample).toBe(20);
    expect(result.queue.every((q) => q.pageId !== result.discovery!.pageId)).toBe(true);
  });

  it("respects exclusions", async () => {
    const { getRandomDiscovery } = await freshEngine();
    const first = await getRandomDiscovery();
    const second = await getRandomDiscovery({ exclude: [first.discovery!.pageId, ...first.queue.map((q) => q.pageId)] });
    expect(second.discovery?.pageId).not.toBe(first.discovery?.pageId);
  });
});

describe("rabbit hole relations", () => {
  it("relates articles only through sourced relations", async () => {
    const doc = parseArticle(loadParseFixture("halting_problem"));
    // Make the article's real links resolvable in the fake universe.
    for (const link of doc.links.slice(0, 30)) universe.set(link.title, meta({ title: link.title, pageId: 90000 + universe.size }));
    for (const title of doc.seeAlso) universe.set(title, meta({ title, pageId: 95000 + universe.size }));
    const { getRelated } = await freshEngine();
    const related = await getRelated(doc, 14);
    expect(related.length).toBeGreaterThan(5);
    const linked = new Set([...doc.links.map((l) => l.title), ...doc.seeAlso]);
    for (const item of related) {
      expect(item.relation).toBeDefined();
      expect(["see-also", "lead-link", "body-link", "shared-category", "similar-text"]).toContain(item.relation!.kind);
      if (item.relation!.kind === "see-also" || item.relation!.kind === "lead-link") expect(linked.has(item.title)).toBe(true);
      expect(item.pageId).not.toBe(doc.pageId);
    }
    expect(related.some((r) => r.relation?.kind === "see-also")).toBe(true);
  });
});
