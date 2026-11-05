import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { __clearWikipediaCaches } from "@/lib/wikipedia/api";
import { __resetRateLimitState } from "@/lib/wikipedia/http";
import { catalogueEntry, recommended, writeSnapshot } from "../support/curated-snapshot";

/** The service and routes over a tiny temporary snapshot, with Wikipedia mocked. */

let dir: string;

beforeAll(() => {
  dir = writeSnapshot({
    snapshot: {
      articles: [recommended(1, "Great Stink"), recommended(2, "Zip bomb"), recommended(3, "Onion Futures Act", { evidence: [] })],
      collections: { most: [1, 2, 3], hidden: [2], recent: [], evergreen: [1], rising: [] },
    },
    catalogue: [
      catalogueEntry(1, "Great Stink", { sources: ["featured", "recommended"], interest: 90, topics: ["History_and_Society.History"] }),
      catalogueEntry(2, "Zip bomb", { sources: ["recommended"], interest: 60, topics: ["STEM.Computing"], monthlyClicks: 2000 }),
      catalogueEntry(10, "Rotman lens", { interest: 70, topics: ["STEM.Engineering"], monthlyClicks: 300, description: "Antenna array device" }),
      catalogueEntry(11, "Tempest prognosticator", { interest: 40, topics: ["Culture.Media.Media*"], monthlyClicks: 50 }),
      catalogueEntry(12, "Cox–Zucker machine", { interest: 30, topics: ["STEM.Mathematics"], monthlyClicks: 8000 }),
    ],
    related: { 1: [{ id: 2, title: "Zip bomb", kind: "co-recommended", weight: 3 }] },
    provenance: [
      [1, "https://news.ycombinator.com/item?id=9", 2000, "Hacker News", "heuristic-test"],
      [1, "https://news.ycombinator.com/item?id=8", 1000, "Lemmy", "review"],
    ],
  });
  vi.stubEnv("WIKIHOLE_SNAPSHOT_DIR", dir);
});

afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  __clearWikipediaCaches();
  __resetRateLimitState();
});

/** Wikipedia returning intros and thumbnails for whatever is asked. */
function wikipediaUp() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const titles = new URL(String(input)).searchParams.get("titles")?.split("|") ?? [];
      return new Response(
        JSON.stringify({
          batchcomplete: true,
          query: { pages: titles.map((title, i) => ({ pageid: 500 + i, ns: 0, title, length: 30000, extract: `${title} is a real intro.`, description: `Live ${title}` })) },
        }),
      );
    }),
  );
}

let ip = 0;
const client = () => ({ "x-forwarded-for": `10.1.0.${++ip}` });
const getReq = (query: string) => new NextRequest(`http://t/api/curated?${query}`, { headers: client() });
const postReq = (body: unknown) => new Request("http://t/api/curated", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...client() } });

describe("collections", () => {
  it("serves a collection in ranked order with its evidence, joined to live metadata", async () => {
    wikipediaUp();
    const { GET } = await import("@/app/api/curated/route");
    const res = await GET(getReq("collection=most&limit=2"));
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.items.map((i: { title: string }) => i.title)).toEqual(["Great Stink", "Zip bomb"]);
    expect(page.total).toBe(3);
    expect(page.nextOffset).toBe(2);
    expect(page.items[0].extract).toContain("real intro");
    expect(page.items[0].pageId).toBe(1);
    expect(page.items[0].recommendation.qualifying).toBe(4);
    expect(page.items[0].recommendation.evidence[0].url).toContain("news.ycombinator.com");
  });

  it("paginates to the end", async () => {
    wikipediaUp();
    const { GET } = await import("@/app/api/curated/route");
    const page = await (await GET(getReq("collection=most&offset=2&limit=2"))).json();
    expect(page.items.map((i: { title: string }) => i.title)).toEqual(["Onion Futures Act"]);
    expect(page.nextOffset).toBeNull();
  });

  it("still renders from the snapshot when Wikipedia is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const { GET } = await import("@/app/api/curated/route");
    const res = await GET(getReq("collection=hidden"));
    expect(res.status).toBe(200);
    const page = await res.json();
    expect(page.items[0].title).toBe("Zip bomb");
    expect(page.items[0].description).toBe("About Zip bomb");
    expect(page.items[0].extract).toBeUndefined();
  });

  it("returns an empty collection honestly and rejects unknown ones", async () => {
    wikipediaUp();
    const { GET } = await import("@/app/api/curated/route");
    const empty = await (await GET(getReq("collection=rising"))).json();
    expect(empty).toEqual({ items: [], total: 0, nextOffset: null });
    expect((await GET(getReq("collection=viral"))).status).toBe(400);
  });

  it("lists every source for an article, newest first", async () => {
    const { GET } = await import("@/app/api/curated/route");
    const { sources } = await (await GET(getReq("sources=1"))).json();
    expect(sources.map((s: { url: string }) => s.url)).toEqual(["https://news.ycombinator.com/item?id=9", "https://news.ycombinator.com/item?id=8"]);
    expect((await GET(getReq("sources=abc"))).status).toBe(400);
  });
});

describe("explore", () => {
  const titles = (page: { items: Array<{ title: string }> }) => page.items.map((i) => i.title);

  it("orders by promise and by quietness", async () => {
    wikipediaUp();
    const { POST } = await import("@/app/api/curated/route");
    expect(titles(await (await POST(postReq({ sort: "promising" }))).json())[0]).toBe("Great Stink");
    expect(titles(await (await POST(postReq({ sort: "quiet" }))).json())[0]).toBe("Tempest prognosticator");
  });

  it("filters by area and text, and can leave out what people already recommended", async () => {
    wikipediaUp();
    const { POST } = await import("@/app/api/curated/route");
    const stem = titles(await (await POST(postReq({ area: "STEM", sort: "promising" }))).json());
    expect(stem).toEqual(["Rotman lens", "Zip bomb", "Cox–Zucker machine"]);
    expect(titles(await (await POST(postReq({ query: "antenna", sort: "promising" }))).json())).toEqual(["Rotman lens"]);
    const fresh = titles(await (await POST(postReq({ unrecommended: true, sort: "promising" }))).json());
    expect(fresh).not.toContain("Great Stink");
    expect(fresh).toContain("Rotman lens");
  });

  it("draws at random without repeating what was excluded", async () => {
    wikipediaUp();
    const { POST } = await import("@/app/api/curated/route");
    const page = await (await POST(postReq({ sort: "surprise", exclude: [1, 2], limit: 3 }))).json();
    expect(page.items.length).toBeGreaterThan(0);
    expect(titles(page)).not.toContain("Great Stink");
    expect(titles(page)).not.toContain("Zip bomb");
  });

  it("validates input", async () => {
    const { POST } = await import("@/app/api/curated/route");
    expect((await POST(postReq({ sort: "chaos" }))).status).toBe(400);
    expect((await POST(postReq({ limit: 9999 }))).status).toBe(400);
  });
});

describe("contextual discovery", () => {
  it("validates input", async () => {
    const { POST } = await import("@/app/api/contextual/route");
    const req = (body: unknown) => new Request("http://t/api/contextual", { method: "POST", body: JSON.stringify(body), headers: client() });
    expect((await POST(req({ titles: [] }))).status).toBe(400);
    expect((await POST(req({ titles: Array(9).fill("x") }))).status).toBe(400);
  });

  it("follows what people paired with the history, and never suggests what was read", async () => {
    const { meta } = await import("../support/meta");
    const { getContextual } = await import("@/lib/discovery/engine");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const titles = url.searchParams.get("titles")?.split("|") ?? [];
        const pages = titles.map((title, i) => {
          const m = meta({ title });
          return { pageid: title === "Zip bomb" ? 2 : 700 + i, ns: 0, title, length: m.length, extract: m.extract, description: m.description, categories: m.categories.map((c) => ({ title: `Category:${c}` })) };
        });
        return new Response(JSON.stringify({ batchcomplete: true, query: { pages, search: [] } }));
      }),
    );
    const items = await getContextual(["Great Stink"]);
    expect(items.map((i) => i.title)).toEqual(["Zip bomb"]);
    expect(items[0].relation).toMatchObject({ kind: "from-history", label: "Because you read Great Stink" });
    expect(items[0].recommended).toEqual({ qualifying: 4, discussions: 3 });
    expect(await getContextual(["Great Stink", "Zip bomb"])).toEqual([]);
  });
});
