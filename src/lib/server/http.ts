import "server-only";
import { after, NextResponse } from "next/server";
import { WikipediaError } from "@/lib/wikipedia/http";

/** Shared helpers for route handlers: rate limiting and error responses. */

const buckets = new Map<string, { tokens: number; updated: number }>();

/**
 * Token-bucket limiter keyed by client IP and route. In-memory, so it is per
 * server instance: it protects Wikimedia and the AI provider from bursts, not
 * a distributed abuse control.
 */
export function rateLimit(request: Request, route: string, perMinute: number): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  const key = `${route}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: perMinute, updated: now };
  bucket.tokens = Math.min(perMinute, bucket.tokens + ((now - bucket.updated) / 60000) * perMinute);
  bucket.updated = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  if (buckets.size > 10000) buckets.clear();
  return true;
}

export function jsonError(message: string, status: number, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function tooManyRequests(): NextResponse {
  return jsonError("Too many requests. Please slow down.", 429, { "Retry-After": "30" });
}

/** Maps data-layer failures to user-facing messages without leaking internals. */
export function describeError(error: unknown): { message: string; status: number } {
  if (error instanceof WikipediaError) {
    switch (error.kind) {
      case "notfound":
        return { message: "That article does not exist on Wikipedia.", status: 404 };
      case "ratelimited":
        return { message: "Wikipedia is rate limiting us right now. Try again in a minute.", status: 503 };
      case "timeout":
        return { message: "Wikipedia took too long to respond. Try again.", status: 504 };
      case "invalid":
        return { message: "Wikipedia returned data we could not read.", status: 502 };
      default:
        return { message: "Wikipedia is unavailable right now. Try again shortly.", status: 502 };
    }
  }
  console.error("[wikihole] unexpected error", error);
  return { message: "Something went wrong on our side.", status: 500 };
}

export function errorResponse(error: unknown): NextResponse {
  const { message, status } = describeError(error);
  return jsonError(message, status);
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Runs an async loader and captures failure as a value (keeps JSX out of try/catch). */
export async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Runs work after the response is sent (Next.js `after`, which also keeps
 * serverless functions alive for it). Outside a request scope, e.g. when a
 * handler is invoked directly, the task simply runs in the background.
 */
export function runAfter(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task().catch(() => {});
  }
}
