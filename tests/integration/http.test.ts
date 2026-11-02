import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetRateLimitState, fetchJson, mwApi, rateLimitCooldownMs, WikipediaError } from "@/lib/wikipedia/http";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

beforeEach(() => __resetRateLimitState());

describe("Wikimedia HTTP client", () => {
  it("sends a User-Agent with operator contact from the environment", async () => {
    vi.stubEnv("WIKIMEDIA_USER_AGENT", "WikiHole/test (ops@example.org)");
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchJson("https://en.wikipedia.org/w/api.php?x=1");
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("WikiHole/test (ops@example.org)");
    expect(headers["Api-User-Agent"]).toBe("WikiHole/test (ops@example.org)");
    vi.unstubAllEnvs();
  });

  it("retries transient 5xx failures and then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(json({ done: true }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://x.test/a")).resolves.toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry budget", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://x.test/b", { retries: 1 })).rejects.toMatchObject({ kind: "http", status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://x.test/c")).rejects.toMatchObject({ kind: "http", status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honours a long Retry-After by entering a cooldown instead of hammering", async () => {
    const fetchMock = vi.fn(async () => new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://x.test/d")).rejects.toMatchObject({ kind: "ratelimited" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rateLimitCooldownMs()).toBeGreaterThan(25000);
    await expect(fetchJson("https://x.test/e")).rejects.toMatchObject({ kind: "ratelimited" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits out a short Retry-After and retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchJson("https://x.test/f")).resolves.toEqual({ ok: 1 });
  });

  it("maps timeouts, network failures, 404 and malformed JSON to typed errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))));
    await expect(fetchJson("https://x.test/g", { timeoutMs: 20, retries: 0 })).rejects.toMatchObject({ kind: "timeout" });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(fetchJson("https://x.test/h", { retries: 0 })).rejects.toMatchObject({ kind: "network" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(fetchJson("https://x.test/i")).rejects.toMatchObject({ kind: "notfound" });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>not json", { status: 200 })));
    await expect(fetchJson("https://x.test/j")).rejects.toMatchObject({ kind: "invalid" });
  });

  it("surfaces Action API errors; missingtitle becomes notfound", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ errors: [{ code: "missingtitle", text: "The page you specified doesn't exist." }] })));
    const error = await mwApi({ action: "parse", page: "Nope" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WikipediaError);
    expect(error).toMatchObject({ kind: "notfound", code: "missingtitle" });

    vi.stubGlobal("fetch", vi.fn(async () => json({ errors: [{ code: "badvalue", text: "Bad" }] })));
    await expect(mwApi({ action: "query" })).rejects.toMatchObject({ kind: "api", code: "badvalue" });

    vi.stubGlobal("fetch", vi.fn(async () => json([1, 2, 3])));
    await expect(mwApi({ action: "query" })).rejects.toMatchObject({ kind: "invalid" });
  });

  it("builds formatversion=2 URLs and omits undefined/false parameters", async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetchMock);
    await mwApi({ action: "query", titles: "A|B", redirects: true, exintro: false, missing: undefined });
    const url = new URL((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("formatversion")).toBe("2");
    expect(url.searchParams.get("redirects")).toBe("1");
    expect(url.searchParams.has("exintro")).toBe(false);
    expect(url.searchParams.has("missing")).toBe(false);
  });
});
