import type { FeedResponse, RandomResponse } from "@/lib/discovery/engine";
import type { FeedPreset } from "@/lib/discovery/types";
import type { Insights } from "@/lib/ai/insights";
import type { ExplainRequest, ExplainResponse } from "@/lib/ai/explain-types";
import type { ReaderTerm } from "@/lib/content/terms";
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

export type InsightsResponse = { enabled: false } | { enabled: true; insights: Insights };

export function fetchInsights(title: string, lang: string = DEFAULT_LANGUAGE, signal?: AbortSignal): Promise<InsightsResponse> {
  return request<InsightsResponse>("/api/insights", { ...json({ title, lang }), signal, timeoutMs: 90000 });
}

export async function fetchTerms(title: string, lang: string = DEFAULT_LANGUAGE): Promise<ReaderTerm[]> {
  const edition = lang === DEFAULT_LANGUAGE ? "" : `&lang=${encodeURIComponent(lang)}`;
  const { terms } = await request<{ terms: ReaderTerm[] }>(`/api/terms?title=${encodeURIComponent(title)}${edition}`);
  return terms;
}

const EXPLANATION_STORAGE_PREFIX = "wikihole:explain:";
const explanations = new Map<string, Promise<ExplainResponse>>();

function storedExplanation(key: string): ExplainResponse | null {
  try {
    const stored = window.sessionStorage.getItem(EXPLANATION_STORAGE_PREFIX + key);
    return stored ? (JSON.parse(stored) as ExplainResponse) : null;
  } catch {
    return null;
  }
}

function storeExplanation(key: string, response: ExplainResponse): void {
  try {
    window.sessionStorage.setItem(EXPLANATION_STORAGE_PREFIX + key, JSON.stringify(response));
  } catch {
    // Storage may be full or blocked; the in-memory copy still serves this page view.
  }
}

/**
 * Generated explanations, cached in memory across client navigations and in
 * sessionStorage across reloads, so re-opening a popover never asks again.
 * Requests are not cancelled when a popover closes: the result is paid for and
 * is what the reader will want if they come back. Failures are not cached.
 */
export function fetchExplanation(body: ExplainRequest): Promise<ExplainResponse> {
  const key = JSON.stringify(body);
  const known = explanations.get(key);
  if (known) return known;
  const stored = storedExplanation(key);
  const pending = stored
    ? Promise.resolve(stored)
    : request<ExplainResponse>("/api/explain", { ...json(body), timeoutMs: 90000 }).then((response) => {
        if (response.enabled) storeExplanation(key, response);
        return response;
      });
  explanations.set(key, pending);
  pending.catch(() => explanations.delete(key));
  return pending;
}
