import type { FeedResponse, RandomResponse } from "@/lib/discovery/engine";
import type { FeedPreset } from "@/lib/discovery/types";
import type { Insights } from "@/lib/ai/insights";
import type { FeedCategory, HackerNewsFeed } from "@/lib/hackernews/service";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import type { SearchSuggestion } from "@/lib/wikipedia/types";

/** Browser-side helpers for WikiHole's own API routes. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const signals = [AbortSignal.timeout(init.timeoutMs ?? 20000)];
  if (init.signal) signals.push(init.signal);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.any(signals) });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError" && init.signal?.aborted) throw error;
    throw new ApiError("Network error. Check your connection and try again.", 0);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // fall through with null body
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

const json = (data: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

export function fetchFeed(
  params: { topic: string | null; preset: FeedPreset; exclude: number[]; limit?: number },
  signal?: AbortSignal,
): Promise<FeedResponse> {
  return request<FeedResponse>("/api/feed", { ...json(params), signal });
}

export function fetchRandom(params: { exclude: number[]; topic?: string | null }, signal?: AbortSignal): Promise<RandomResponse> {
  return request<RandomResponse>("/api/random", { ...json(params), signal });
}

export function fetchSuggestions(q: string, lang: string = DEFAULT_LANGUAGE, signal?: AbortSignal): Promise<{ results: SearchSuggestion[] }> {
  const edition = lang === DEFAULT_LANGUAGE ? "" : `&lang=${encodeURIComponent(lang)}`;
  return request(`/api/search?q=${encodeURIComponent(q)}${edition}`, { signal, timeoutMs: 10000 });
}

export type LanguageStatsResponse = { languages: Array<{ code: string; articles: number | null }> };

/** Live article counts for language editions (all supported editions when `codes` is omitted). */
export function fetchLanguageStats(codes?: string[], signal?: AbortSignal): Promise<LanguageStatsResponse> {
  const query = codes?.length ? `?codes=${encodeURIComponent(codes.join(","))}` : "";
  return request<LanguageStatsResponse>(`/api/languages${query}`, { signal, timeoutMs: 30000 });
}

export function fetchHackerNews(
  params: { category: FeedCategory; offset?: number; limit?: number },
  signal?: AbortSignal,
): Promise<HackerNewsFeed> {
  const qs = new URLSearchParams({ category: params.category, offset: String(params.offset ?? 0), limit: String(params.limit ?? 15) });
  return request<HackerNewsFeed>(`/api/hackernews?${qs}`, { signal, timeoutMs: 45000 });
}

export type InsightsResponse = { enabled: false } | { enabled: true; insights: Insights };

export function fetchInsights(title: string, lang: string = DEFAULT_LANGUAGE, signal?: AbortSignal): Promise<InsightsResponse> {
  return request<InsightsResponse>("/api/insights", { ...json({ title, lang }), signal, timeoutMs: 90000 });
}
