import { beforeEach, describe, expect, it, vi } from "vitest";
import { __clearWikipediaCaches } from "@/lib/wikipedia/api";
import { __resetRateLimitState } from "@/lib/wikipedia/http";

/** Route handlers exercised directly with Request objects and a failing/mocked Wikipedia. */

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers } });

let ip = 0;
const client = () => ({ "x-forwarded-for": `10.0.0.${++ip}` });

beforeEach(() => {
  __clearWikipediaCaches();
  __resetRateLimitState();
});

describe("POST /api/feed", () => {
  it("validates input", async () => {
    const { POST } = await import("@/app/api/feed/route");
    expect((await POST(post("http://t/api/feed", "{oops", client()))).status).toBe(400);
    expect((await POST(post("http://t/api/feed", { limit: 1000 }, client()))).status).toBe(400);
    expect((await POST(post("http://t/api/feed", { topic: "celebrity-gossip" }, client()))).status).toBe(400);
  });

  it("returns a graceful 5xx JSON error when Wikipedia is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));
    const { POST } = await import("@/app/api/feed/route");
    const res = await POST(post("http://t/api/feed", { topic: "topology" }, client()));
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Wikipedia/);
    expect(JSON.stringify(body)).not.toMatch(/stack|at fetch/i);
  });

  it("rate limits bursts per client", async () => {
    const { POST } = await import("@/app/api/feed/route");
    const headers = { "x-forwarded-for": "10.9.9.9" };
    let last = 0;
    for (let i = 0; i < 45; i++) last = (await POST(post("http://t/api/feed", "{bad", headers))).status;
    expect(last).toBe(429);
  });
});

describe("GET /api/search", () => {
  it("returns no results for very short queries without calling Wikipedia", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(new Request("http://t/api/search?q=a"));
    expect(await res.json()).toEqual({ results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects overlong queries and reports upstream failures", async () => {
    const { GET } = await import("@/app/api/search/route");
    expect((await GET(new Request(`http://t/api/search?q=${"x".repeat(300)}`))).status).toBe(400);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}{", { status: 200 })));
    const res = await GET(new Request("http://t/api/search?q=entropy", { headers: client() }));
    expect(res.status).toBe(502);
  });
});

describe("POST /api/insights", () => {
  it("reports AI as disabled when no credentials are configured", async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/insights/route");
    const res = await POST(post("http://t/api/insights", { title: "Halting problem" }, client()));
    expect(await res.json()).toEqual({ enabled: false });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("GET /api/health", () => {
  it("reports configuration without exposing secrets", async () => {
    vi.stubEnv("AI_API_KEY", "sk-secret-value");
    const { GET } = await import("@/app/api/health/route");
    const body = JSON.stringify(await GET().json());
    expect(body).toContain('"ai":true');
    expect(body).not.toContain("sk-secret-value");
    vi.unstubAllEnvs();
  });
});
