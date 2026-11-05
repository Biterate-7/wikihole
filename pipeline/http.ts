/**
 * Polite HTTP for the pipeline: one identifying User-Agent, a minimum gap per
 * host, retries with backoff, Retry-After honoured, and robots.txt checked for
 * every source that is not an official API.
 */

const DEFAULT_USER_AGENT = "WikiHole-pipeline/0.1 (https://github.com/Biterate-7/wikihole)";

export function pipelineUserAgent(): string {
  return process.env.WIKIHOLE_PIPELINE_USER_AGENT?.trim() || DEFAULT_USER_AGENT;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const nextSlot = new Map<string, number>();

async function waitForHost(host: string, gapMs: number): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, at + gapMs);
  if (at > now) await sleep(at - now);
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const isRetryable = (status: number) => status === 408 || status === 429 || status >= 500;

export interface FetchOptions {
  /** Minimum gap between requests to this host. */
  gapMs?: number;
  retries?: number;
  timeoutMs?: number;
  accept?: string;
}

/** What this process has asked for, so every run can report its own failures. */
export const httpCounters = { requests: 0, retries: 0, failures: 0, byStatus: {} as Record<string, number> };

export async function politeFetch(url: string, options: FetchOptions = {}): Promise<Response> {
  const { gapMs = 1000, retries = 5, timeoutMs = 60_000, accept } = options;
  const host = new URL(url).hostname;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitForHost(host, gapMs);
    httpCounters.requests++;
    if (attempt > 0) httpCounters.retries++;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": pipelineUserAgent(), "Api-User-Agent": pipelineUserAgent(), ...(accept ? { Accept: accept } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      httpCounters.byStatus[response.status] = (httpCounters.byStatus[response.status] ?? 0) + 1;
      if (response.ok) return response;
      if (!isRetryable(response.status)) throw new HttpError(`HTTP ${response.status} for ${url}`, response.status);
      const retryAfter = Number(response.headers.get("retry-after"));
      lastError = new HttpError(`HTTP ${response.status} for ${url}`, response.status);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
    } catch (error) {
      if (error instanceof HttpError && !isRetryable(error.status)) {
        httpCounters.failures++;
        throw error;
      }
      lastError = error;
      await sleep(2000 * 2 ** attempt);
    }
  }
  httpCounters.failures++;
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

/** The timeout also covers reading the body, which can stall after the headers arrive, so that is retried too. */
export async function fetchJson<T>(url: string, options?: FetchOptions): Promise<T> {
  const retries = options?.retries ?? 5;
  for (let attempt = 0; ; attempt++) {
    const response = await politeFetch(url, { accept: "application/json", ...options });
    try {
      return (await response.json()) as T;
    } catch (error) {
      if (attempt >= retries) {
        httpCounters.failures++;
        throw error;
      }
      httpCounters.retries++;
      await sleep(2000 * 2 ** attempt);
    }
  }
}

/* ------------------------------------------------------------------------ */
/* robots.txt                                                                */
/* ------------------------------------------------------------------------ */

export interface RobotsRules {
  allowed: (path: string) => boolean;
  crawlDelayMs: number | null;
}

/** The subset of RFC 9309 we need: groups for `*`, longest match wins, allow beats disallow on ties. */
export function parseRobots(body: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }>; delay: number | null }> = [];
  let current: (typeof groups)[number] | null = null;
  let collectingAgents = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (value) current.rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay") {
      const delay = Number(value);
      if (Number.isFinite(delay)) current.delay = delay;
    }
  }
  const applicable = groups.filter((g) => g.agents.includes("*"));
  const rules = applicable.flatMap((g) => g.rules);
  const delay = applicable.map((g) => g.delay).find((d) => d !== null) ?? null;
  const matches = (pattern: string, path: string) => {
    const regex = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    return new RegExp(`^${regex}`).test(path);
  };
  return {
    crawlDelayMs: delay === null ? null : delay * 1000,
    allowed: (path) => {
      let best: { allow: boolean; path: string } | null = null;
      for (const rule of rules) {
        if (!matches(rule.path, path)) continue;
        if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
      }
      return best?.allow ?? true;
    },
  };
}

const robotsCache = new Map<string, Promise<RobotsRules>>();

export function robotsFor(origin: string): Promise<RobotsRules> {
  let rules = robotsCache.get(origin);
  if (!rules) {
    rules = politeFetch(`${origin}/robots.txt`, { retries: 2 })
      .then(async (response) => parseRobots(await response.text()))
      .catch((error: unknown) => {
        // RFC 9309: a missing file allows everything; an unreachable one disallows everything.
        if (error instanceof HttpError && error.status >= 400 && error.status < 500) return parseRobots("");
        return { allowed: () => false, crawlDelayMs: null };
      });
    robotsCache.set(origin, rules);
  }
  return rules;
}
