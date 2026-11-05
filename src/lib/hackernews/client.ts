import "server-only";
import { z } from "zod";
import { TtlCache } from "@/lib/cache";
import { userAgent } from "@/lib/wikipedia/http";
import type { HnList } from "./types";

/**
 * Access to the official Hacker News Firebase API
 * (https://github.com/HackerNews/API). The API has no published rate limit,
 * but we keep a small concurrency budget, time out slow requests, retry
 * transient failures with exponential backoff, and cache aggressively so the
 * same lists and items are not fetched repeatedly. Nothing here fabricates
 * data: failures surface as typed errors.
 */

export type HackerNewsErrorKind = "timeout" | "network" | "http" | "invalid";

export class HackerNewsError extends Error {
  constructor(
    message: string,
    readonly kind: HackerNewsErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HackerNewsError";
  }

  get retryable(): boolean {
    return this.kind === "timeout" || this.kind === "network" || (this.kind === "http" && (this.status === 429 || (this.status ?? 0) >= 500));
  }
}

export const HN_API_URL = process.env.HACKER_NEWS_API_URL || "https://hacker-news.firebaseio.com/v0";

const LIST_ENDPOINT: Record<HnList, string> = {
  top: "topstories",
  best: "beststories",
  new: "newstories",
  ask: "askstories",
  show: "showstories",
  job: "jobstories",
};

const TIMEOUT_MS = 8000;
const RETRIES = 2;
const MAX_CONCURRENT = 12;

let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await run();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new HackerNewsError(`Hacker News request timed out after ${TIMEOUT_MS}ms`, "timeout");
    }
    throw new HackerNewsError("Could not reach Hacker News", "network");
  }
  if (!response.ok) throw new HackerNewsError(`Hacker News responded with HTTP ${response.status}`, "http", response.status);
  try {
    return await response.json();
  } catch {
    throw new HackerNewsError("Hacker News returned malformed JSON", "invalid");
  }
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: HackerNewsError | undefined;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await withSlot(() => fetchOnce(url));
    } catch (error) {
      const hnError = error instanceof HackerNewsError ? error : new HackerNewsError("Unexpected Hacker News client error", "network");
      lastError = hnError;
      if (!hnError.retryable || attempt === RETRIES) throw hnError;
      await sleep(Math.min(250 * 2 ** attempt + Math.random() * 100, 3000));
    }
  }
  throw lastError ?? new HackerNewsError("Hacker News request failed", "network");
}

/* ------------------------------------------------------------------------ */
/* Schemas                                                                   */
/* ------------------------------------------------------------------------ */

const idListSchema = z.array(z.number().int().positive());

export const rawItemSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(["story", "comment", "job", "poll", "pollopt"]).optional(),
  by: z.string().optional(),
  time: z.number().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  text: z.string().optional(),
  score: z.number().optional(),
  descendants: z.number().optional(),
  kids: z.array(z.number()).optional(),
  parent: z.number().optional(),
  deleted: z.boolean().optional(),
  dead: z.boolean().optional(),
});
export type RawItem = z.infer<typeof rawItemSchema>;

/* ------------------------------------------------------------------------ */
/* Caches                                                                    */
/* ------------------------------------------------------------------------ */

const MINUTE = 60 * 1000;
const listCache = new TtlCache<number[]>(20, 3 * MINUTE);
const itemCache = new TtlCache<RawItem | null>(4000, 15 * MINUTE);

/* ------------------------------------------------------------------------ */
/* Public API                                                                */
/* ------------------------------------------------------------------------ */

/** Ids from one of the story lists, in Hacker News order (up to 500; 200 for best/ask/show/job). */
export async function getStoryIds(list: HnList): Promise<number[]> {
  return listCache.getOrLoad(list, async () => {
    const raw = await fetchJson(`${HN_API_URL}/${LIST_ENDPOINT[list]}.json`);
    const parsed = idListSchema.safeParse(raw);
    if (!parsed.success) throw new HackerNewsError(`Hacker News returned a malformed ${list} list`, "invalid");
    return parsed.data;
  });
}

/**
 * One item. Returns null when the item does not exist (the API answers
 * `null`); deleted and dead items are returned as-is so callers can decide.
 */
export async function getItem(id: number): Promise<RawItem | null> {
  return itemCache.getOrLoad(String(id), async () => {
    const raw = await fetchJson(`${HN_API_URL}/item/${id}.json`);
    if (raw === null) return null;
    const parsed = rawItemSchema.safeParse(raw);
    if (!parsed.success) throw new HackerNewsError(`Hacker News returned a malformed item ${id}`, "invalid");
    return parsed.data;
  });
}

/**
 * Many items, fetched concurrently within the client's budget. Items that
 * fail to load are reported separately so one bad item never sinks a batch.
 */
export async function getItems(ids: number[]): Promise<{ items: RawItem[]; failed: number[] }> {
  const unique = [...new Set(ids)];
  const settled = await Promise.allSettled(unique.map((id) => getItem(id)));
  const items: RawItem[] = [];
  const failed: number[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      if (result.value) items.push(result.value);
    } else failed.push(unique[i]);
  });
  if (unique.length > 0 && failed.length === unique.length) {
    const first = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    throw first?.reason ?? new HackerNewsError("Hacker News is unavailable", "network");
  }
  return { items, failed };
}

/** Exposed for tests. */
export function __clearHackerNewsCaches(): void {
  listCache.clear();
  itemCache.clear();
}
