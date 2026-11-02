import { describe, expect, it } from "vitest";
import { parseArticle } from "@/lib/content/parse";
import { getFeed, getRandomDiscovery } from "@/lib/discovery/engine";
import { SUBTOPICS } from "@/lib/discovery/topics";
import { fullSearch, getParsedHtml, getSummary, searchSuggestions } from "@/lib/wikipedia/api";
import { mwApi } from "@/lib/wikipedia/http";
import { cleanExtract } from "@/lib/wikipedia/text";

/**
 * Hits the real Wikipedia APIs. Run with `npm run test:live` (sets
 * LIVE_WIKIPEDIA=1). Set WIKIMEDIA_USER_AGENT with contact details first.
 */
const live = process.env.LIVE_WIKIPEDIA === "1";

describe.skipIf(!live)("live Wikipedia integration", { timeout: 60000 }, () => {
  it("every topic category exists on Wikipedia", async () => {
    const categories = [...new Set(Object.values(SUBTOPICS).flatMap((s) => s.categories))];
    const missing: string[] = [];
    for (let i = 0; i < categories.length; i += 50) {
      const batch = categories.slice(i, i + 50);
      const raw = await mwApi({ action: "query", prop: "categoryinfo", titles: batch.map((c) => `Category:${c}`).join("|") });
      const pages = (raw.query as { pages: Array<{ title: string; missing?: boolean; categoryinfo?: { pages: number } }> }).pages;
      for (const p of pages) if (p.missing || (p.categoryinfo?.pages ?? 0) < 3) missing.push(p.title);
    }
    expect(missing).toEqual([]);
  });

  it("feed descriptions are Wikipedia's own text", async () => {
    const feed = await getFeed({ limit: 6 });
    expect(feed.items.length).toBeGreaterThanOrEqual(4);
    expect(new Set(feed.items.map((i) => i.pageId)).size).toBe(feed.items.length);
    for (const item of feed.items.slice(0, 3)) {
      // Compare with the intro straight from TextExtracts (the source we display)...
      const raw = await mwApi({ action: "query", prop: "extracts", exintro: true, explaintext: true, titles: item.title });
      const intro = cleanExtract((raw.query as { pages: Array<{ extract?: string }> }).pages[0].extract) ?? "";
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 60);
      expect(norm(item.extract)).toBe(norm(intro));
      expect(item.extract).not.toContain("\\displaystyle");
      // ...and confirm via the REST API that it is a standard article page.
      expect((await getSummary(item.title)).type).toBe("standard");
    }
  });

  it("search finds the halting problem and the article parses into sections", async () => {
    const suggestions = await searchSuggestions("halting problem");
    expect(suggestions[0].title).toBe("Halting problem");
    const full = await fullSearch("halting problem");
    expect(full.total).toBeGreaterThan(100);
    const page = await getParsedHtml("Halting problem");
    const doc = parseArticle({ ...page, categories: page.categories.filter((c) => !c.hidden).map((c) => c.name) });
    expect(doc.sections.length).toBeGreaterThan(4);
    expect(doc.references.length).toBeGreaterThan(10);
  });

  it("random discovery filters uniformly random pages through the quality gate", async () => {
    const result = await getRandomDiscovery();
    expect(result.discovery).not.toBeNull();
    expect(result.stats.uniformSample).toBeGreaterThan(0);
    expect(result.stats.accepted).toBeLessThan(result.stats.sampled);
    expect(result.discovery!.extract.length).toBeGreaterThan(80);
  });
});
