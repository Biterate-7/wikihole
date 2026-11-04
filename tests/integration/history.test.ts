import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearWikipediaCaches } from "@/lib/wikipedia/api";
import { __resetRateLimitState } from "@/lib/wikipedia/http";
import { __clearRevisionCaches, compareRevisions, ComparisonError, getArticleHistory, getRevisionPage } from "@/lib/wikipedia/revisions";

/** The revision layer against a scripted Wikimedia: real parsing, no network. */

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

const NOW = Date.parse("2026-11-04T00:00:00Z");

const revisionsBody = {
  query: {
    pages: [
      {
        title: "Test article",
        revisions: [
          { revid: 30, parentid: 20, user: "Ann", timestamp: "2026-11-01T00:00:00Z", size: 1500, comment: "/* History */ added date", minor: true, tags: [] },
          { revid: 20, parentid: 10, user: "192.0.2.1", anon: true, timestamp: "2026-10-30T00:00:00Z", size: 1400, comment: "", tags: ["mw-reverted"] },
          { revid: 10, parentid: 0, userhidden: true, timestamp: "2020-01-01T00:00:00Z", size: 1000, commenthidden: true, tags: [] },
        ],
      },
    ],
  },
};

const firstBody = { query: { pages: [{ revisions: [{ revid: 10, parentid: 0, user: "Founder", timestamp: "2020-01-01T00:00:00Z" }] }] } };

/** Answers each kind of request separately, so a test can break just one. */
function wikimedia(overrides: Partial<Record<"edits" | "editors" | "first" | "recent", () => Response>> = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/history/counts/edits")) return overrides.edits?.() ?? json({ count: 30000, limit: true });
    if (url.includes("/history/counts/editors")) return overrides.editors?.() ?? json({ count: 321, limit: false });
    if (url.includes("rvdir=newer")) return overrides.first?.() ?? json(firstBody);
    return overrides.recent?.() ?? json(revisionsBody);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  __clearWikipediaCaches();
  __clearRevisionCaches();
  __resetRateLimitState();
});

describe("getArticleHistory", () => {
  it("reports exactly what Wikimedia returned", async () => {
    wikimedia();
    const history = await getArticleHistory("Test article", "en", NOW);
    expect(history.edits).toEqual({ count: 30000, capped: true });
    expect(history.contributors).toEqual({ count: 321, capped: false });
    expect(history.created).toEqual({ timestamp: "2020-01-01T00:00:00Z", contributor: { kind: "registered", name: "Founder" } });
    expect(history.activity).toMatchObject({ edits: 2, complete: true, contributors: 2, bytesAdded: 500, bytesRemoved: 0 });
  });

  it("describes each kind of contributor and size change", async () => {
    wikimedia();
    const { recent } = await getArticleHistory("Test article", "en", NOW);
    expect(recent?.[0]).toMatchObject({ id: 30, sizeDelta: 100, minor: true, reverted: false, contributor: { kind: "registered", name: "Ann" }, summary: { section: "History", text: "added date" } });
    expect(recent?.[1]).toMatchObject({ reverted: true, summary: null, contributor: { kind: "anonymous" } });
    expect(recent?.[1].contributor.name).toBeUndefined();
    expect(recent?.[2]).toMatchObject({ sizeDelta: 1000, summaryHidden: true, summary: null, contributor: { kind: "hidden" } });
  });

  it("marks temporary accounts", async () => {
    wikimedia({ recent: () => json({ query: { pages: [{ revisions: [{ revid: 5, parentid: 0, user: "~2026-1-1", temp: true, timestamp: "2026-11-01T00:00:00Z", size: 9 }] }] } }) });
    const { recent } = await getArticleHistory("Test article", "en", NOW);
    expect(recent?.[0].contributor).toEqual({ kind: "temporary", name: "~2026-1-1" });
  });

  it("leaves out only what failed, inventing nothing", async () => {
    wikimedia({ edits: () => new Response("nope", { status: 404 }), first: () => json({ query: { pages: [{}] } }) });
    const history = await getArticleHistory("Test article", "en", NOW);
    expect(history.edits).toBeNull();
    expect(history.created).toBeNull();
    expect(history.contributors?.count).toBe(321);
    expect(history.recent).toHaveLength(3);
  });

  it("survives Wikimedia being entirely unavailable", async () => {
    wikimedia({
      edits: () => new Response("", { status: 404 }),
      editors: () => new Response("", { status: 404 }),
      first: () => new Response("", { status: 404 }),
      recent: () => new Response("", { status: 404 }),
    });
    await expect(getArticleHistory("Test article", "en", NOW)).resolves.toEqual({ edits: null, contributors: null, created: null, recent: null, activity: null });
  });

  it("does not repeat requests within the cache lifetime", async () => {
    const { fetchMock } = wikimedia();
    await getArticleHistory("Test article", "en", NOW);
    const first = fetchMock.mock.calls.length;
    await getArticleHistory("Test article", "en", NOW);
    expect(first).toBe(4);
    expect(fetchMock.mock.calls.length).toBe(first);
  });

  it("asks the article's own edition, and escapes slashes in titles", async () => {
    const { calls } = wikimedia();
    await getArticleHistory("AC/DC", "de", NOW);
    expect(calls.some((u) => u.startsWith("https://de.wikipedia.org/w/rest.php/v1/page/AC%2FDC/history/counts/edits"))).toBe(true);
    expect(calls.some((u) => u.startsWith("https://de.wikipedia.org/w/api.php"))).toBe(true);
  });
});

describe("getRevisionPage", () => {
  it("uses the extra revision for the last size change and as the next page's start", async () => {
    wikimedia();
    const page = await getRevisionPage("Test article", "en", { limit: 2 });
    expect(page.revisions.map((r) => r.id)).toEqual([30, 20]);
    expect(page.revisions[1].sizeDelta).toBe(400);
    expect(page.olderFrom).toBe(10);
  });

  it("reports an unknown size change as unknown", async () => {
    wikimedia({ recent: () => json({ query: { pages: [{ revisions: [{ revid: 30, parentid: 20, timestamp: "t", size: 5 }] }] } }) });
    expect((await getRevisionPage("Test article")).revisions[0].sizeDelta).toBeNull();
  });

  it("throws for a missing page rather than showing an empty history", async () => {
    wikimedia({ recent: () => json({ query: { pages: [{ missing: true }] } }) });
    await expect(getRevisionPage("Nothing here")).rejects.toMatchObject({ kind: "notfound" });
  });
});

const compareBody = {
  compare: {
    fromrevid: 20,
    fromtitle: "Test article",
    fromsize: 1400,
    fromtimestamp: "2026-10-30T00:00:00Z",
    fromuser: "Bo",
    fromcomment: "/* Intro */ tidy",
    torevid: 30,
    totitle: "Test article",
    tosize: 1500,
    totimestamp: "2026-11-01T00:00:00Z",
    touser: "Ann",
    tocomment: "added",
    prev: 10,
    next: 40,
    body: `<tr><td class="diff-marker"></td><td class="diff-deletedline"><div><del>old</del></div></td><td class="diff-marker"></td><td class="diff-addedline"><div><ins>newer</ins></div></td></tr>`,
  },
};

describe("compareRevisions", () => {
  it("returns the diff with both revisions and the way to the neighbouring edits", async () => {
    const fetchMock = vi.fn(async () => json(compareBody));
    vi.stubGlobal("fetch", fetchMock);
    const comparison = await compareRevisions("Test article", 30, 20);
    expect(comparison.from).toMatchObject({ id: 20, summary: { section: "Intro", text: "tidy" }, contributor: { name: "Bo" } });
    expect(comparison.to).toMatchObject({ id: 30, size: 1500, contributor: { name: "Ann" } });
    expect(comparison.olderId).toBe(10);
    expect(comparison.newerId).toBe(40);
    expect(comparison.charsAdded).toBe(5);
    expect(comparison.charsRemoved).toBe(3);
    const url = new URL(String((fetchMock.mock.calls as unknown as Array<[string]>)[0][0]));
    expect(url.searchParams.get("action")).toBe("compare");
    expect(url.searchParams.get("fromrev")).toBe("20");
    expect(url.searchParams.get("torev")).toBe("30");
  });

  it("compares with the parent when no older revision is given", async () => {
    const fetchMock = vi.fn(async () => json(compareBody));
    vi.stubGlobal("fetch", fetchMock);
    await compareRevisions("Test article", 30, undefined);
    const url = new URL(String((fetchMock.mock.calls as unknown as Array<[string]>)[0][0]));
    expect(url.searchParams.get("fromrev")).toBe("30");
    expect(url.searchParams.get("torelative")).toBe("prev");
  });

  it("treats the first revision as having nothing to compare with", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ compare: { torevid: 10, totitle: "Test article", tosize: 9, touser: "Founder" } })));
    const comparison = await compareRevisions("Test article", 10, undefined);
    expect(comparison.from).toBeNull();
    expect(comparison.rows).toEqual([]);
  });

  it("refuses revisions from another article", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ compare: { ...compareBody.compare, totitle: "Other article" } })));
    await expect(compareRevisions("Test article", 30, 20)).rejects.toBeInstanceOf(ComparisonError);
  });

  it("does not ask Wikimedia twice for the same stored revisions", async () => {
    const fetchMock = vi.fn(async () => json(compareBody));
    vi.stubGlobal("fetch", fetchMock);
    await compareRevisions("Test article", 30, 20);
    await compareRevisions("Test article", 30, 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces API errors with their code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ errors: [{ code: "nosuchrevid", text: "There is no revision with ID 1." }] })));
    await expect(compareRevisions("Test article", 1, 2)).rejects.toMatchObject({ kind: "api", code: "nosuchrevid" });
  });
});
