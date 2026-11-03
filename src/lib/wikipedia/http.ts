import "server-only";
import { DEFAULT_LANGUAGE, isSupportedLanguage, wikipediaDomain } from "@/lib/i18n/languages";

/**
 * Low-level HTTP access to Wikimedia APIs, following
 * https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits:
 * a User-Agent with contact information, at most 3 concurrent requests,
 * timeouts, bounded retries with backoff, and Retry-After respected (a long
 * Retry-After puts the whole client into a cooldown instead of retrying).
 * Nothing here ever fabricates a response.
 */

export type WikipediaErrorKind = "timeout" | "network" | "http" | "api" | "invalid" | "notfound" | "ratelimited";

export class WikipediaError extends Error {
  constructor(
    message: string,
    readonly kind: WikipediaErrorKind,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "WikipediaError";
  }

  /** Server-suggested delay before retrying, when provided. */
  retryAfterMs: number | null = null;

  get retryable(): boolean {
    return (
      this.kind === "timeout" ||
      this.kind === "network" ||
      (this.kind === "http" && (this.status === 429 || (this.status ?? 0) >= 500)) ||
      (this.kind === "api" && this.code === "maxlag")
    );
  }
}

export const WIKIPEDIA_API_URL = process.env.WIKIPEDIA_API_URL || "https://en.wikipedia.org/w/api.php";
export const WIKIPEDIA_REST_URL = process.env.WIKIPEDIA_REST_URL || "https://en.wikipedia.org/api/rest_v1";

/**
 * Action API endpoint for a language edition. The environment overrides
 * apply to the default (English) edition, which keeps test doubles working.
 */
export function apiUrlFor(lang: string = DEFAULT_LANGUAGE): string {
  if (lang === DEFAULT_LANGUAGE || !isSupportedLanguage(lang)) return WIKIPEDIA_API_URL;
  return `https://${wikipediaDomain(lang)}/w/api.php`;
}

export function restUrlFor(lang: string = DEFAULT_LANGUAGE): string {
  if (lang === DEFAULT_LANGUAGE || !isSupportedLanguage(lang)) return WIKIPEDIA_REST_URL;
  return `https://${wikipediaDomain(lang)}/api/rest_v1`;
}

const DEFAULT_USER_AGENT = "WikiHole/1.0 (Wikipedia discovery client; set WIKIMEDIA_USER_AGENT to add operator contact)";

export function userAgent(): string {
  return process.env.WIKIMEDIA_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
}

export interface RequestOptions {
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  /** Wikipedia language edition (Action API calls only). Defaults to English. */
  lang?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RETRIES = 2;
const MAX_BACKOFF_MS = 4000;
/** Retry-After values above this are not waited out inline; the client cools down instead. */
const MAX_INLINE_RETRY_AFTER_MS = 5000;

// Wikimedia asks clients to limit concurrency to 3 or fewer.
const MAX_CONCURRENT = 3;
let cooldownUntil = 0;

/** Milliseconds until the client may contact Wikimedia again (0 = now). */
export function rateLimitCooldownMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

/** Exposed for tests. */
export function __resetRateLimitState(): void {
  cooldownUntil = 0;
}
let active = 0;
const queue: Array<() => void> = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active++;
  try {
    return await run();
  } finally {
    active--;
    queue.shift()?.();
  }
}

function retryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function backoffMs(attempt: number, retryAfter: number | null): number {
  if (retryAfter !== null) return retryAfter;
  const base = 300 * 2 ** attempt;
  return Math.min(base + Math.random() * 150, MAX_BACKOFF_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const wait = rateLimitCooldownMs();
  if (wait > 0) {
    throw new WikipediaError(`Wikipedia rate limit: retry in ${Math.ceil(wait / 1000)}s`, "ratelimited", 429);
  }
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": userAgent(),
        "Api-User-Agent": userAgent(),
        Accept: "application/json",
      },
      signal: AbortSignal.any(signals),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new WikipediaError(`Wikipedia request timed out after ${timeoutMs}ms`, "timeout");
    }
    throw new WikipediaError("Could not reach Wikipedia", "network");
  }

  if (response.status === 404) {
    throw new WikipediaError("Wikipedia resource not found", "notfound", 404);
  }
  if (!response.ok) {
    const retryAfter = retryAfterMs(response.headers.get("retry-after"));
    if ((response.status === 429 || response.status === 503) && retryAfter !== null && retryAfter > MAX_INLINE_RETRY_AFTER_MS) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + retryAfter);
      throw new WikipediaError("Wikipedia is rate limiting requests", "ratelimited", response.status);
    }
    const error = new WikipediaError(`Wikipedia responded with HTTP ${response.status}`, "http", response.status);
    error.retryAfterMs = retryAfter;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new WikipediaError("Wikipedia returned malformed JSON", "invalid");
  }
}

/** Fetches JSON from a Wikimedia endpoint with timeout + retry. */
export async function fetchJson(url: string, options: RequestOptions = {}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: WikipediaError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withSlot(() => fetchOnce(url, timeoutMs, options.signal));
    } catch (error) {
      const wikiError =
        error instanceof WikipediaError ? error : new WikipediaError("Unexpected Wikipedia client error", "network");
      lastError = wikiError;
      if (!wikiError.retryable || attempt === retries || options.signal?.aborted) throw wikiError;
      await sleep(backoffMs(attempt, wikiError.retryAfterMs));
    }
  }
  throw lastError ?? new WikipediaError("Wikipedia request failed", "network");
}

export type ApiParams = Record<string, string | number | boolean | undefined>;

/** Calls the MediaWiki Action API (formatversion=2) and surfaces API errors. */
export async function mwApi(params: ApiParams, options?: RequestOptions): Promise<Record<string, unknown>> {
  const url = new URL(apiUrlFor(options?.lang));
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("errorformat", "plaintext");
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false) continue;
    url.searchParams.set(key, value === true ? "1" : String(value));
  }
  const json = await fetchJson(url.toString(), options);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new WikipediaError("Wikipedia returned an unexpected payload", "invalid");
  }
  const record = json as Record<string, unknown>;
  const errors = record.errors ?? record.error;
  if (errors) {
    const first = (Array.isArray(errors) ? errors[0] : errors) as { code?: string; text?: string; info?: string };
    const code = first?.code ?? "unknown";
    const kind = code === "missingtitle" || code === "invalidtitle" ? "notfound" : "api";
    throw new WikipediaError(first?.text ?? first?.info ?? `Wikipedia API error: ${code}`, kind, undefined, code);
  }
  return record;
}
