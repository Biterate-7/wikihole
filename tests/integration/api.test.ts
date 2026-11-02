import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearWikipediaCaches,
  fullSearch,
  getPagesMeta,
  getPagesMetaMap,
  getParsedHtml,
  getSummary,
  searchCandidates,
  searchSuggestions,
  snippetRuns,
} from "@/lib/wikipedia/api";
import { __resetRateLimitState } from "@/lib/wikipedia/http";

type Handler = (url: URL) => unknown;

function route(handler: Handler) {
  const fetchMock = vi.fn(async (input: string) => {
    const body = handler(new URL(input));
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  __clearWikipediaCaches();
  __resetRateLimitState();
});

const halting = {
  pageid: 21391870,
  ns: 0,
  title: "Halting problem",
  length: 56052,
  description: "Problem in computer science",
  extract: "In computability theory, the halting problem is the decision problem of determining whether a program halts.",
  thumbnail: { source: "https://thumb.wikimedia.org/wikipedia/commons/thumb/x/Diagram.svg/330px-Diagram.svg.png", width: 330, height: 200 },
  pageprops: { wikibase_item: "Q622849" },
  pageassessments: { "Computer science": { class: "C" }, "Project-independent assessment": { class: "B" } },
  revisions: [{ timestamp: "2026-10-19T03:11:46Z" }],
  categories: [{ title: "Category:Computability theory" }, { title: "Category:Undecidable problems" }],
};

describe("page metadata", () => {
  it("normalises pages, follows redirects and merges continuation rounds", async () => {
    const fetchMock = route((url) => {
      if (!url.searchParams.has("pvipcontinue")) {
        return {
          continue: { pvipcontinue: "Halting_problem", continue: "||" },
          query: {
            redirects: [{ from: "Halting Problem", to: "Halting problem" }],
            pages: [
              { ...halting, categories: [...halting.categories, { title: "Category:Hidden thing", hidden: true }] },
              { pageid: 5, ns: 0, title: "Halting (disambiguation)", length: 500, pageprops: { disambiguation: "" } },
              { ns: 0, title: "Nonexistent page", missing: true },
            ],
          },
        };
      }
      return {
        batchcomplete: true,
        query: { pages: [{ pageid: 21391870, ns: 0, title: "Halting problem", pageviews: { "2026-10-01": 300, "2026-10-02": null, "2026-10-03": 200 } }] },
      };
    });

    const map = await getPagesMetaMap(["Halting Problem", "Halting (disambiguation)", "Nonexistent page"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const meta = map.get("Halting Problem");
    expect(meta).toMatchObject({
      pageId: 21391870,
      title: "Halting problem",
      assessment: "B",
      recentViews: 500,
      disambiguation: false,
      wikidataId: "Q622849",
      lastEdited: "2026-10-19T03:11:46Z",
      categories: ["Computability theory", "Undecidable problems"],
    });
    expect(meta?.thumbnail?.src).toMatch(/^https:\/\/thumb\.wikimedia\.org\//);
    expect(map.get("Halting (disambiguation)")?.disambiguation).toBe(true);
    expect(map.get("Nonexistent page")).toBeNull();

    // Served from cache afterwards.
    const ordered = await getPagesMeta(["Halting problem", "Halting Problem"]);
    expect(ordered).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("batches requests in groups of 20 (the TextExtracts limit)", async () => {
    const fetchMock = route((url) => ({
      batchcomplete: true,
      query: {
        pages: (url.searchParams.get("titles") ?? "").split("|").map((t, i) => ({ pageid: i + 1 + t.length * 100, ns: 0, title: t, length: 9000 })),
      },
    }));
    const titles = Array.from({ length: 45 }, (_, i) => `Topic ${i}`);
    await getPagesMeta(titles);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(new URL((call as unknown as [string])[0]).searchParams.get("titles")!.split("|").length).toBeLessThanOrEqual(20);
    }
  });

  it("tolerates missing optional metadata", async () => {
    route(() => ({ batchcomplete: true, query: { pages: [{ pageid: 9, ns: 0, title: "Bare page" }] } }));
    const [meta] = await getPagesMeta(["Bare page"]);
    expect(meta).toMatchObject({ title: "Bare page", length: 0, recentViews: null, categories: [], disambiguation: false });
    expect(meta.thumbnail).toBeUndefined();
    expect(meta.assessment).toBeUndefined();
  });

  it("drops thumbnails from unexpected hosts", async () => {
    route(() => ({ batchcomplete: true, query: { pages: [{ ...halting, thumbnail: { source: "https://evil.example/x.png", width: 1, height: 1 } }] } }));
    const [meta] = await getPagesMeta(["Halting problem"]);
    expect(meta.thumbnail).toBeUndefined();
  });

  it("rejects malformed responses instead of fabricating data", async () => {
    route(() => ({ query: { pages: "not an array" } }));
    await expect(getPagesMeta(["Anything"])).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("search", () => {
  it("orders typeahead suggestions by relevance index", async () => {
    route(() => ({
      batchcomplete: true,
      query: {
        pages: [
          { pageid: 2, ns: 0, title: "Halting (disambiguation)", index: 2, pageprops: { disambiguation: "" } },
          { pageid: 1, ns: 0, title: "Halting problem", index: 1, description: "Problem in computer science", length: 56052 },
        ],
      },
    }));
    const results = await searchSuggestions("halting problem");
    expect(results.map((r) => r.title)).toEqual(["Halting problem", "Halting (disambiguation)"]);
    expect(results[1].disambiguation).toBe(true);
    expect(await searchSuggestions("   ")).toEqual([]);
  });

  it("parses snippets into safe highlighted runs", () => {
    expect(snippetRuns('the <span class="searchmatch">halting</span> problem &amp; <b>more</b>')).toEqual([
      { text: "the ", match: false },
      { text: "halting", match: true },
      { text: " problem & more", match: false },
    ]);
  });

  it("returns full results with totals, suggestions and pagination", async () => {
    route((url) => {
      if (url.searchParams.get("list") === "search") {
        return {
          query: {
            searchinfo: { totalhits: 2, suggestion: "halting problem" },
            search: [{ ns: 0, title: "Halting problem", pageid: 21391870, size: 56052, wordcount: 5000, snippet: '<span class="searchmatch">Halting</span>' }],
          },
        };
      }
      return { batchcomplete: true, query: { pages: [halting] } };
    });
    const result = await fullSearch("haltng problem");
    expect(result).toMatchObject({ total: 2, suggestion: "halting problem", offset: 0 });
    expect(result.hits[0]).toMatchObject({ title: "Halting problem", description: "Problem in computer science" });
    expect(result.nextOffset).toBeUndefined();
  });

  it("returns empty results for no matches", async () => {
    route(() => ({ query: { searchinfo: { totalhits: 0 }, search: [] } }));
    const result = await fullSearch("qwxzvbnmasdf");
    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("requests random-sorted candidates for discovery sampling", async () => {
    const fetchMock = route(() => ({ query: { search: [{ ns: 0, title: "Raft (algorithm)", pageid: 1, size: 20000, wordcount: 2000 }] } }));
    const hits = await searchCandidates("incategory:Distributed_algorithms", { sort: "random", limit: 50 });
    expect(hits[0]).toMatchObject({ title: "Raft (algorithm)", wordCount: 2000 });
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("srsort")).toBe("random");
    expect(url.searchParams.get("srnamespace")).toBe("0");
  });
});

describe("article content", () => {
  it("parses action=parse output and decodes the display title", async () => {
    route(() => ({
      parse: {
        title: "Halting problem",
        pageid: 21391870,
        revid: 1,
        displaytitle: '<span class="mw-page-title-main">Halting problem</span>',
        text: "<div class='mw-parser-output'><p>Text</p></div>",
        categories: [{ category: "Computability_theory" }, { category: "Hidden", hidden: true }],
      },
    }));
    const page = await getParsedHtml("halting_problem");
    expect(page).toMatchObject({ title: "Halting problem", displayTitle: "Halting problem", revId: 1 });
    expect(page.categories).toEqual([
      { name: "Computability theory", hidden: false },
      { name: "Hidden", hidden: true },
    ]);
  });

  it("reports missing articles as notfound and rejects invalid titles without a request", async () => {
    const fetchMock = route(() => ({ errors: [{ code: "missingtitle", text: "missing" }] }));
    await expect(getParsedHtml("Definitely not an article")).rejects.toMatchObject({ kind: "notfound" });
    await expect(getParsedHtml("Bad|Title")).rejects.toMatchObject({ kind: "notfound" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads REST page summaries", async () => {
    route(() => ({ type: "standard", title: "Halting problem", extract: "In computability theory...", description: "Problem in computer science" }));
    await expect(getSummary("Halting problem")).resolves.toMatchObject({ type: "standard", extract: "In computability theory..." });
  });
});
