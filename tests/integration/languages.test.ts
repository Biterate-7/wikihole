import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseArticle } from "@/lib/content/parse";
import { getRelated } from "@/lib/discovery/engine";
import {
  __clearWikipediaCaches,
  fullSearch,
  getPagesMeta,
  getParsedHtml,
  getSiteStatistics,
  getSummary,
  searchSuggestions,
} from "@/lib/wikipedia/api";
import { __resetRateLimitState, apiUrlFor, restUrlFor } from "@/lib/wikipedia/http";

/** Language editions: every request goes to the selected wiki, and caches never mix editions. */

type Handler = (url: URL) => unknown;

function route(handler: Handler) {
  const fetchMock = vi.fn(async (input: string) => {
    const body = handler(new URL(input));
    if (body === undefined) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const hosts = (fetchMock: ReturnType<typeof route>) => fetchMock.mock.calls.map(([input]) => new URL(input as string).host);

let ip = 0;
const client = () => ({ "x-forwarded-for": `10.1.0.${++ip}` });

beforeEach(() => {
  __clearWikipediaCaches();
  __resetRateLimitState();
});

describe("edition endpoints", () => {
  it("maps languages to their own wiki and rejects unknown codes", () => {
    expect(apiUrlFor("ja")).toBe("https://ja.wikipedia.org/w/api.php");
    expect(restUrlFor("de")).toBe("https://de.wikipedia.org/api/rest_v1");
    expect(apiUrlFor()).toBe("https://en.wikipedia.org/w/api.php");
    // Never builds a host from an unvalidated code.
    expect(apiUrlFor("evil.example.com#")).toBe("https://en.wikipedia.org/w/api.php");
  });

  it("searches, reads and summarises the selected edition", async () => {
    const fetchMock = route((url) => {
      if (url.pathname.includes("/page/summary/")) return { type: "standard", title: "停止性問題", extract: "停止性問題は…" };
      if (url.searchParams.get("action") === "parse") {
        return { parse: { title: "停止性問題", pageid: 7, revid: 9, text: "<p>本文</p>", categories: [] } };
      }
      if (url.searchParams.get("generator") === "search") {
        return { query: { pages: [{ pageid: 7, ns: 0, title: "停止性問題", index: 1, description: "数学の問題" }] } };
      }
      if (url.searchParams.get("list") === "search") {
        return { query: { search: [{ ns: 0, title: "停止性問題", pageid: 7, size: 9000, wordcount: 1200 }], searchinfo: { totalhits: 1 } } };
      }
      return { query: { pages: [{ pageid: 7, ns: 0, title: "停止性問題", length: 9000, extract: "停止性問題は、計算可能性理論の問題である。" }] } };
    });

    const suggestions = await searchSuggestions("停止", 8, "ja");
    expect(suggestions.map((s) => s.title)).toEqual(["停止性問題"]);
    const results = await fullSearch("停止", 0, 20, "ja");
    expect(results.hits[0]?.title).toBe("停止性問題");
    const page = await getParsedHtml("停止性問題", 0, "ja");
    expect(page.pageId).toBe(7);
    const summary = await getSummary("停止性問題", "ja");
    expect(summary.title).toBe("停止性問題");
    const [meta] = await getPagesMeta(["停止性問題"], "ja");
    expect(meta?.lang).toBe("ja");

    expect(new Set(hosts(fetchMock))).toEqual(new Set(["ja.wikipedia.org"]));
  });

  it("keeps caches separate per edition", async () => {
    const fetchMock = route((url) => ({
      query: { pages: [{ pageid: url.host.startsWith("de") ? 2 : 1, ns: 0, title: "Entropie", length: 5000 }] },
    }));
    const [de] = await getPagesMeta(["Entropie"], "de");
    const [fr] = await getPagesMeta(["Entropie"], "fr");
    expect(de?.pageId).toBe(2);
    expect(fr?.pageId).toBe(1);
    expect(fr?.lang).toBe("fr");
    expect(hosts(fetchMock)).toEqual(["de.wikipedia.org", "fr.wikipedia.org"]);
    // English results carry no lang field, exactly as before languages existed.
    const [en] = await getPagesMeta(["Entropie"]);
    expect(en && "lang" in en).toBe(false);
  });

  it("reads article counts from siteinfo statistics and caches them", async () => {
    const fetchMock = route((url) => {
      expect(url.searchParams.get("meta")).toBe("siteinfo");
      expect(url.searchParams.get("siprop")).toBe("statistics");
      return { query: { statistics: { articles: url.host.startsWith("pl") ? 1711400 : 3159340 } } };
    });
    expect(await getSiteStatistics("pl")).toEqual({ lang: "pl", articles: 1711400 });
    expect(await getSiteStatistics("de")).toEqual({ lang: "de", articles: 3159340 });
    await getSiteStatistics("pl");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed statistics instead of inventing a count", async () => {
    route(() => ({ query: { statistics: { pages: 10 } } }));
    await expect(getSiteStatistics("it")).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("related articles in another edition", () => {
  it("discovers related pages on the article's own wiki and links them there", async () => {
    const html = `<div class="mw-parser-output"><p>Die <a href="/wiki/Turingmaschine">Turingmaschine</a> und das
      <a href="/wiki/Entscheidungsproblem">Entscheidungsproblem</a> hängen zusammen.</p></div>`;
    const doc = parseArticle({ title: "Halteproblem", displayTitle: "Halteproblem", pageId: 1, revId: 1, html, categories: ["Berechenbarkeitstheorie"], lang: "de" });
    const fetchMock = route((url) => {
      if (url.searchParams.get("list") === "search") return { query: { search: [] } };
      const titles = (url.searchParams.get("titles") ?? "").split("|");
      return {
        query: {
          pages: titles.map((title, i) => ({
            pageid: 100 + i,
            ns: 0,
            title,
            length: 30000,
            extract: `${title} ist ein zentrales Konzept der theoretischen Informatik und der Berechenbarkeitstheorie.`,
            categories: [{ title: "Kategorie:Berechenbarkeitstheorie" }],
          })),
        },
      };
    });
    const related = await getRelated(doc);
    expect(related.length).toBeGreaterThan(0);
    for (const item of related) {
      expect(item.lang).toBe("de");
      expect(item.url).toMatch(/^https:\/\/de\.wikipedia\.org\/wiki\//);
    }
    expect(new Set(hosts(fetchMock))).toEqual(new Set(["de.wikipedia.org"]));
  });
});

describe("GET /api/search with a language", () => {
  it("validates the edition and searches it", async () => {
    const fetchMock = route(() => ({ query: { pages: [{ pageid: 3, ns: 0, title: "Entropie", index: 1 }] } }));
    const { GET } = await import("@/app/api/search/route");
    const bad = await GET(new Request("http://t/api/search?q=entropie&lang=xx", { headers: client() }));
    expect(bad.status).toBe(400);
    const res = await GET(new Request("http://t/api/search?q=entropie&lang=fr", { headers: client() }));
    expect(res.status).toBe(200);
    expect((await res.json()).results[0].title).toBe("Entropie");
    expect(hosts(fetchMock)).toEqual(["fr.wikipedia.org"]);
  });
});

describe("GET /api/languages", () => {
  it("returns live counts and reports unreachable editions as null", async () => {
    route((url) => (url.host.startsWith("ja") ? { query: { statistics: { articles: 1523000 } } } : undefined));
    const { GET } = await import("@/app/api/languages/route");
    const res = await GET(new Request("http://t/api/languages?codes=ja,de", { headers: client() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      languages: [
        { code: "ja", articles: 1523000 },
        { code: "de", articles: null },
      ],
    });
    // Partial results must not be cached by the CDN.
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects unsupported languages", async () => {
    const { GET } = await import("@/app/api/languages/route");
    const res = await GET(new Request("http://t/api/languages?codes=en,klingon", { headers: client() }));
    expect(res.status).toBe(400);
  });
});
