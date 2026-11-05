// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CuratedItem } from "@/components/curated/CuratedItem";
import { ExploreFeed } from "@/components/curated/ExploreFeed";
import { RecommendedFeed } from "@/components/curated/RecommendedFeed";
import type { CuratedItem as Item } from "@/lib/curated/service";
import { historyStore } from "@/lib/storage/collections";
import { recommended } from "../support/curated-snapshot";

const item = (overrides: Partial<Item> = {}): Item => ({
  pageId: 1,
  title: "Great Stink",
  url: "https://en.wikipedia.org/wiki/Great_Stink",
  description: "1858 event in London",
  extract: "The Great Stink was an event in central London.",
  readingMinutes: 9,
  ...overrides,
});

function mockFetch(handler: (url: string, init?: RequestInit) => unknown, status = 200) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify(handler(String(input), init)), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CuratedItem", () => {
  it("states the counts and shows traceable evidence on request", async () => {
    const user = userEvent.setup();
    render(<CuratedItem item={item({ recommendation: recommended(1, "Great Stink", { qualifying: 12, discussions: 9 }) })} rank={1} />);
    expect(screen.getByTestId("curated-count").textContent).toBe("12 recommendations");
    expect(screen.queryByTestId("curated-evidence")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Why people recommend it" }));
    const quote = screen.getByTestId("curated-evidence");
    expect(quote.textContent).toContain("The Wikipedia article on Great Stink is great.");
    expect(within(quote).getByRole("link", { name: /Hacker News/ }).getAttribute("href")).toBe("https://news.ycombinator.com/item?id=1");
  });

  it("loads every source when asked", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => ({ sources: [{ url: "https://news.ycombinator.com/item?id=77", at: 1000, community: "Hacker News", decidedBy: "x" }] }));
    render(<CuratedItem item={item({ recommendation: recommended(1, "Great Stink", { qualifying: 12 }) })} rank={1} />);
    await user.click(screen.getByRole("button", { name: "Why people recommend it" }));
    await user.click(screen.getByRole("button", { name: "All 12 sources" }));
    await screen.findByTestId("curated-sources");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/curated?sources=1");
  });

  it("describes catalogue articles by Wikipedia's signals, and claims no recommendations", async () => {
    const user = userEvent.setup();
    render(<CuratedItem item={item({ sources: ["good", "unusual"], incomingLinks: 540, topics: ["STEM.Physics"], monthlyClicks: 3400 })} rank={1} />);
    expect(screen.queryByTestId("curated-count")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Wikipedia signals" }));
    expect(screen.getByText(/good article/)).toBeTruthy();
    expect(screen.getByText(/unusual articles/)).toBeTruthy();
    expect(screen.getByText("540 articles link here")).toBeTruthy();
  });

  it("drops the thumbnail slot when there is no image", () => {
    render(<CuratedItem item={item()} rank={1} />);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("RecommendedFeed", () => {
  const page = (titles: string[], nextOffset: number | null = null) => ({ items: titles.map((title, i) => item({ pageId: i + 1, title, recommendation: recommended(i + 1, title) })), total: titles.length, nextOffset });

  it("switches collection without leaving the page and keeps the URL shareable", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => page(["Zip bomb"]));
    render(<RecommendedFeed initial={page(["Great Stink"])} view="most" />);
    expect(screen.getByRole("link", { name: "Great Stink" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hidden gems" }));
    await screen.findByRole("link", { name: "Zip bomb" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/curated?collection=hidden&offset=0");
    expect(window.location.search).toBe("?c=hidden");
    expect(screen.getByRole("button", { name: "Hidden gems" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("appends on Load more", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ ...page(["Zip bomb"]), items: [item({ pageId: 2, title: "Zip bomb" })] }));
    render(<RecommendedFeed initial={page(["Great Stink"], 1)} view="most" />);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("link", { name: "Zip bomb" });
    expect(screen.getByRole("link", { name: "Great Stink" })).toBeTruthy();
  });

  it("shows a retry when the server could not load the collection", () => {
    render(<RecommendedFeed initial={null} view="most" />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("explains an empty collection instead of filling it", () => {
    render(<RecommendedFeed initial={{ items: [], total: 0, nextOffset: null }} view="rising" />);
    expect(screen.getByText("Nothing qualifies for this collection yet.")).toBeTruthy();
  });

  it("builds From your reading from local history, sending only titles", async () => {
    const user = userEvent.setup();
    historyStore.set([{ title: "Great Stink", visitedAt: 1 }] as never);
    const fetchMock = mockFetch(() => ({
      items: [
        {
          pageId: 2,
          title: "Zip bomb",
          extract: "A zip bomb is a file.",
          url: "https://en.wikipedia.org/wiki/Zip_bomb",
          readingMinutes: 3,
          topCategories: [],
          recentViews: 10,
          score: { total: 50, components: { technical: 0, quality: 0, depth: 0, obscurity: 0, diversity: 0, exploration: 0 }, signals: [] },
          relation: { kind: "from-history", label: "Because you read Great Stink" },
        },
      ],
    }));
    render(<RecommendedFeed initial={page(["Other"])} view="most" />);
    await user.click(screen.getByRole("button", { name: "From your reading" }));
    await screen.findByText("Because you read Great Stink");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/contextual");
    expect(JSON.parse(String(init?.body)).titles).toEqual(["Great Stink"]);
    await waitFor(() => expect(screen.getByRole("link", { name: "Zip bomb" })).toBeTruthy());
  });

  it("asks for nothing when there is no history", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => ({ items: [] }));
    render(<RecommendedFeed initial={page(["Other"])} view="most" />);
    await user.click(screen.getByRole("button", { name: "From your reading" }));
    await screen.findByText("Nothing to go on yet.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ExploreFeed", () => {
  const query = { query: "", area: null, sort: "surprise" as const, unrecommended: false };
  const explorePage = { items: [item({ pageId: 5, title: "Rotman lens" })], total: 1, nextOffset: null };

  it("filters through the API and reflects filters in the URL", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => explorePage);
    render(<ExploreFeed initial={{ items: [item()], total: 1, nextOffset: null }} query={query} />);
    await user.click(screen.getByRole("button", { name: "Science and technology" }));
    await screen.findByRole("link", { name: "Rotman lens" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ area: "STEM", sort: "surprise" });
    expect(window.location.search).toBe("?area=STEM");

    await user.type(screen.getByRole("searchbox"), "antenna{Enter}");
    await waitFor(() => expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ query: "antenna" }));
  });

  it("is honest about what an empty filter searched", () => {
    render(<ExploreFeed initial={{ items: [], total: 0, nextOffset: null }} query={{ ...query, query: "zzz" }} />);
    expect(screen.getByText(/published part of the catalogue/)).toBeTruthy();
  });
});
