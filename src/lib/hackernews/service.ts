import "server-only";
import { z } from "zod";
import { BUILDER_VERSION, buildRabbitHole } from "@/lib/discovery/rabbit-hole-builder";
import type { Exploration, ExplorationPreview, SubmissionScore } from "@/lib/discovery/hole-types";
import { extractEntities } from "@/lib/discovery/entity-extraction";
import { createDocumentStore } from "@/lib/server/persistence";
import { rateLimitCooldownMs, WikipediaError } from "@/lib/wikipedia/http";
import { getItem } from "./client";
import { discoverSubmissions, topComments } from "./ingestion";
import { normalizeItem, rejectRawItem } from "./normalization";
import { HN_MODEL, finalScore, prescore, type Prescore } from "./ranking";
import { HN_LISTS, type Submission, type SubmissionRejectReason } from "./types";

/**
 * The Hacker News discovery source: ingestion, de-duplication, a bounded
 * processing queue that turns promising submissions into rabbit holes, and
 * durable storage of the results.
 *
 * - Each submission is processed once per builder version. Metadata (points,
 *   comments) is refreshed on later ingestions without rebuilding.
 * - Builds draw on a shared Wikipedia request budget (BUILDS_PER_WINDOW per
 *   window; in the background one at a time and at least
 *   BACKGROUND_SPACING_MS apart), so bursts of traffic never fan out into
 *   hundreds of Wikipedia requests. Background work stops while the
 *   Wikipedia client is cooling down after a rate limit, so it never starves
 *   interactive features such as search and the reader.
 * - Failed builds are retried with exponential backoff; insufficient holes
 *   are retried once later (Wikipedia may have been degraded), then kept out
 *   of the feed.
 */

export type EntryStatus = "pending" | "building" | "complete" | "insufficient" | "failed" | "rejected";
export type FeedCategory = "all" | "top" | "best" | "new" | "ask" | "show";
export const FEED_CATEGORIES: FeedCategory[] = ["all", "top", "best", "new", "ask", "show"];

const INGEST_TTL_MS = 5 * 60 * 1000;
const BUILD_WINDOW_MS = 10 * 60 * 1000;
const BUILDS_PER_WINDOW = 8;
/** Background builds run one at a time; a first visit may warm up with two. */
const BACKGROUND_CONCURRENCY = 1;
const WARMUP_CONCURRENCY = 2;
/**
 * Minimum gap between background builds. A build costs roughly 15–25 Wikipedia
 * requests; pacing keeps background traffic near 40 requests a minute so it
 * cannot burst into the budget that search, the reader and edition counts share.
 */
const BACKGROUND_SPACING_MS = 30_000;
const MAX_FAILED_ATTEMPTS = 3;
const INSUFFICIENT_RETRY_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 1500;
const MAX_EXPLORATIONS = 300;

/* ------------------------------------------------------------------------ */
/* Storage                                                                   */
/* ------------------------------------------------------------------------ */

const submissionSchema = z.object({
  id: z.number(),
  title: z.string(),
  subject: z.string(),
  url: z.string().optional(),
  domain: z.string().optional(),
  author: z.string(),
  score: z.number(),
  comments: z.number(),
  time: z.number(),
  category: z.enum(["story", "ask", "show", "launch", "tell", "job", "poll"]),
  hnUrl: z.string(),
  text: z.string().optional(),
  year: z.number().optional(),
  lists: z.array(z.enum(HN_LISTS)),
  kids: z.array(z.number()),
  fetchedAt: z.number(),
});

const prescoreSchema = z.object({
  total: z.number(),
  components: z.object({ technical: z.number(), novelty: z.number(), relevance: z.number(), engagement: z.number() }),
  penalty: z.number(),
  signals: z.array(z.string()),
  reject: z.string().nullable(),
});

// Explorations are produced by this codebase; a light structural check guards against foreign or truncated data.
const explorationSchema = z.custom<Exploration>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as Exploration).version === "number" &&
    Array.isArray((value as Exploration).nodes) &&
    Array.isArray((value as Exploration).edges) &&
    typeof (value as Exploration).quality?.score === "number",
);

const entrySchema = z.object({
  submission: submissionSchema,
  prescore: prescoreSchema,
  status: z.enum(["pending", "building", "complete", "insufficient", "failed", "rejected"]),
  attempts: z.number(),
  lastAttempt: z.number().optional(),
  error: z.string().optional(),
  exploration: explorationSchema.optional(),
});

export type Entry = Omit<z.infer<typeof entrySchema>, "prescore"> & { prescore: Prescore };

interface StoreDocument {
  version: 1;
  lastIngest: number;
  entries: Record<string, Entry>;
}

const storeSchema = z
  .object({ version: z.literal(1), lastIngest: z.number(), entries: z.record(z.string(), z.unknown()) })
  .transform((doc): StoreDocument => {
    const entries: Record<string, Entry> = {};
    for (const [id, raw] of Object.entries(doc.entries)) {
      const parsed = entrySchema.safeParse(raw);
      // A build interrupted by a restart goes back to the queue.
      if (parsed.success) entries[id] = { ...parsed.data, status: parsed.data.status === "building" ? "pending" : parsed.data.status } as Entry;
    }
    return { version: 1, lastIngest: doc.lastIngest, entries };
  });

const store = createDocumentStore<StoreDocument>("hackernews", storeSchema, () => ({ version: 1, lastIngest: 0, entries: {} }));

function prune(doc: StoreDocument): void {
  const all = Object.values(doc.entries).sort((a, b) => b.submission.time - a.submission.time);
  let explorations = 0;
  for (const [i, entry] of all.entries()) {
    if (i >= MAX_ENTRIES) {
      delete doc.entries[entry.submission.id];
      continue;
    }
    if (entry.exploration && ++explorations > MAX_EXPLORATIONS) {
      doc.entries[entry.submission.id] = { ...entry, exploration: undefined, status: "pending", attempts: 0 };
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Scoring helpers                                                           */
/* ------------------------------------------------------------------------ */

function prescoreOf(submission: Submission): Prescore {
  const extraction = extractEntities({ subject: submission.subject, text: submission.text, domain: submission.domain });
  return prescore(submission, extraction.disciplines, extraction.candidates.length);
}

function initialStatus(pre: Prescore): EntryStatus {
  return pre.reject || pre.total < HN_MODEL.minPrescore ? "rejected" : "pending";
}

function rescored(entry: Entry): SubmissionScore | undefined {
  if (!entry.exploration?.metrics) return entry.exploration?.score;
  return finalScore(entry.prescore, { ...entry.exploration.metrics, quality: entry.exploration.quality });
}

/* ------------------------------------------------------------------------ */
/* Ingestion                                                                 */
/* ------------------------------------------------------------------------ */

let ingesting: Promise<void> | null = null;
let lastIngestError: string | null = null;

async function ingest(): Promise<void> {
  const { submissions } = await discoverSubmissions();
  const doc = await store.read();
  for (const submission of submissions) {
    const existing = doc.entries[submission.id];
    const pre = prescoreOf(submission);
    if (!existing) {
      doc.entries[submission.id] = { submission, prescore: pre, status: initialStatus(pre), attempts: 0 };
      continue;
    }
    // Same submission seen again: refresh its metadata, never reprocess it.
    const lists = [...new Set([...existing.submission.lists, ...submission.lists])];
    const updated: Entry = { ...existing, submission: { ...submission, lists }, prescore: pre };
    if (updated.exploration) {
      updated.exploration = { ...updated.exploration, submission: updated.submission };
      const score = rescored(updated);
      if (score) updated.exploration.score = score;
    }
    if (existing.status === "rejected" && initialStatus(pre) === "pending") updated.status = "pending";
    doc.entries[submission.id] = updated;
  }
  doc.lastIngest = Date.now();
  prune(doc);
  store.write(doc);
  lastIngestError = null;
}

async function ensureIngested(): Promise<void> {
  const doc = await store.read();
  const stale = Date.now() - doc.lastIngest > INGEST_TTL_MS;
  if (!stale) return;
  ingesting ??= ingest()
    .catch((error) => {
      lastIngestError = error instanceof Error ? error.message : "Hacker News ingestion failed";
      throw error;
    })
    .finally(() => {
      ingesting = null;
    });
  // With nothing stored yet the caller must wait; otherwise refresh in the background.
  if (Object.keys(doc.entries).length === 0) await ingesting;
  else ingesting.catch(() => {});
}

/* ------------------------------------------------------------------------ */
/* Processing queue                                                          */
/* ------------------------------------------------------------------------ */

const building = new Map<number, Promise<Entry>>();
let buildLog: number[] = [];

function budgetLeft(): number {
  const now = Date.now();
  buildLog = buildLog.filter((t) => now - t < BUILD_WINDOW_MS);
  return BUILDS_PER_WINDOW - buildLog.length;
}

function due(entry: Entry, now = Date.now()): boolean {
  if (building.has(entry.submission.id)) return false;
  if (entry.status === "pending") return true;
  if (entry.status === "failed") {
    return entry.attempts < MAX_FAILED_ATTEMPTS && now - (entry.lastAttempt ?? 0) > 60_000 * 2 ** entry.attempts;
  }
  if (entry.status === "insufficient") return entry.attempts < 2 && now - (entry.lastAttempt ?? 0) > INSUFFICIENT_RETRY_MS;
  if (entry.status === "complete") return entry.exploration?.version !== BUILDER_VERSION;
  return false;
}

async function buildEntry(id: number): Promise<Entry> {
  const pending = building.get(id);
  if (pending) return pending;
  const run = (async () => {
    const doc = await store.read();
    const entry = doc.entries[id];
    if (!entry) throw new Error(`Unknown submission ${id}`);
    buildLog.push(Date.now());
    doc.entries[id] = { ...entry, status: "building" };
    try {
      const comments = await topComments(entry.submission);
      const exploration = await buildRabbitHole({ submission: entry.submission, comments, prescore: entry.prescore });
      // Parts of a build degrade gracefully on errors; one that ran into a rate limit is incomplete, not weak.
      if (exploration.quality.status !== "complete" && rateLimitCooldownMs() > 0) {
        const requeued: Entry = { ...entry, status: "pending", lastAttempt: Date.now() };
        doc.entries[id] = requeued;
        return requeued;
      }
      const next: Entry = {
        ...entry,
        status: exploration.quality.status,
        attempts: entry.attempts + 1,
        lastAttempt: Date.now(),
        error: undefined,
        exploration,
      };
      doc.entries[id] = next;
      return next;
    } catch (error) {
      console.warn(`[wikihole] rabbit hole for HN ${id} failed:`, error instanceof Error ? error.message : error);
      // Rate limiting is transient and says nothing about the submission: requeue without using an attempt.
      const rateLimited = (error instanceof WikipediaError && error.kind === "ratelimited") || rateLimitCooldownMs() > 0;
      const next: Entry = {
        ...entry,
        status: rateLimited ? "pending" : "failed",
        attempts: rateLimited ? entry.attempts : entry.attempts + 1,
        lastAttempt: Date.now(),
        error: error instanceof Error ? error.message : "Build failed",
      };
      doc.entries[id] = next;
      return next;
    } finally {
      store.write(doc);
    }
  })().finally(() => building.delete(id));
  building.set(id, run);
  return run;
}

/** Submissions waiting for a rabbit hole, most promising first. */
async function queue(): Promise<Entry[]> {
  const doc = await store.read();
  const now = Date.now();
  return Object.values(doc.entries)
    .filter((e) => due(e, now))
    .sort((a, b) => b.prescore.total - a.prescore.total);
}

/** Builds up to `max` queued submissions within the budget, `concurrency` at a time. */
export async function processQueue(max = 4, concurrency = BACKGROUND_CONCURRENCY): Promise<number> {
  let processed = 0;
  while (processed < max) {
    if (rateLimitCooldownMs() > 0) break;
    const slots = Math.min(concurrency - building.size, budgetLeft(), max - processed);
    if (slots <= 0) break;
    const next = (await queue()).slice(0, slots);
    if (next.length === 0) break;
    await Promise.all(next.map((e) => buildEntry(e.submission.id)));
    processed += next.length;
  }
  return processed;
}

let lastBackgroundBuild = 0;

/**
 * Background step run after responses: at most one build, and only once the
 * spacing has elapsed. Requests (including the feed's own polling) keep the
 * queue moving, so progress continues without ever bursting.
 */
export async function processBackground(): Promise<number> {
  if (building.size > 0 || Date.now() - lastBackgroundBuild < BACKGROUND_SPACING_MS) return 0;
  lastBackgroundBuild = Date.now();
  return processQueue(1, BACKGROUND_CONCURRENCY);
}

/* ------------------------------------------------------------------------ */
/* Queries                                                                   */
/* ------------------------------------------------------------------------ */

export function toPreview(exploration: Exploration): ExplorationPreview {
  const primary = exploration.summary.primary;
  const tags = [...exploration.summary.secondary, ...exploration.summary.prerequisites, ...exploration.summary.historical]
    .filter((t) => t !== primary?.title)
    .slice(0, 4);
  return {
    submission: exploration.submission,
    ...(primary ? { primary } : {}),
    tags,
    disciplines: exploration.summary.disciplines,
    articleCount: exploration.nodes.filter((n) => n.level > 0).length,
    quality: exploration.quality.score,
    score: exploration.score,
    builtAt: exploration.builtAt,
  };
}

function inCategory(submission: Submission, category: FeedCategory): boolean {
  if (category === "all") return true;
  if (category === "ask") return submission.category === "ask" || submission.lists.includes("ask");
  if (category === "show") return submission.category === "show" || submission.lists.includes("show");
  return submission.lists.includes(category);
}

export interface HackerNewsFeed {
  items: ExplorationPreview[];
  category: FeedCategory;
  offset: number;
  nextOffset: number | null;
  total: number;
  /** Promising submissions still waiting for (or undergoing) analysis. */
  pending: number;
  processing: Array<{ id: number; title: string }>;
  /** Analysed but too weak to show, and filtered out before analysis. */
  insufficient: number;
  rejected: number;
  lastIngest: number;
  /** Set when the latest refresh from Hacker News failed (stored results are still served). */
  warning: string | null;
}

export interface FeedOptions {
  category?: FeedCategory;
  offset?: number;
  limit?: number;
  /** Builds to wait for when too few explorations exist yet (first visit). */
  warmup?: number;
  /** Runs work after the response (Next.js `after`); defaults to fire-and-forget. */
  schedule?: (task: () => Promise<unknown>) => void;
}

const MIN_READY = 6;
const WARMUP_BUDGET_MS = 12_000;

export async function getHackerNewsFeed({
  category = "all",
  offset = 0,
  limit = 15,
  warmup = 2,
  schedule = (task) => void task().catch(() => {}),
}: FeedOptions = {}): Promise<HackerNewsFeed> {
  await ensureIngested();
  const ready = () => store.read().then((doc) => Object.values(doc.entries).filter((e) => e.status === "complete").length);
  if (warmup > 0 && (await ready()) < MIN_READY) {
    // First visits wait (briefly) for a couple of holes instead of showing an empty page.
    await Promise.race([processQueue(warmup, WARMUP_CONCURRENCY), new Promise((resolve) => setTimeout(resolve, WARMUP_BUDGET_MS))]);
  }
  schedule(processBackground);

  const doc = await store.read();
  const entries = Object.values(doc.entries).filter((e) => inCategory(e.submission, category));
  const complete = entries
    .filter((e): e is Entry & { exploration: Exploration } => e.status === "complete" && Boolean(e.exploration))
    .sort((a, b) => b.exploration.score.total - a.exploration.score.total);
  const page = complete.slice(offset, offset + limit);
  return {
    items: page.map((e) => toPreview(e.exploration)),
    category,
    offset,
    nextOffset: offset + page.length < complete.length ? offset + page.length : null,
    total: complete.length,
    pending: entries.filter((e) => e.status === "pending" || e.status === "building" || (e.status === "failed" && e.attempts < MAX_FAILED_ATTEMPTS)).length,
    processing: [...building.keys()].flatMap((id) => (doc.entries[id] ? [{ id, title: doc.entries[id].submission.title }] : [])),
    insufficient: entries.filter((e) => e.status === "insufficient").length,
    rejected: entries.filter((e) => e.status === "rejected").length,
    lastIngest: doc.lastIngest,
    warning: lastIngestError,
  };
}

export type ExplorationResult =
  | { status: "complete" | "insufficient"; exploration: Exploration }
  | { status: "rejected"; reason: SubmissionRejectReason | "low-score"; submission: Submission | null }
  | { status: "failed"; error: string; submission: Submission }
  | { status: "notfound" };

/**
 * The rabbit hole for one submission, building it on demand if needed (any
 * Hacker News story id works, not only ones in the current lists).
 */
export async function getExploration(id: number): Promise<ExplorationResult> {
  const doc = await store.read();
  let entry = doc.entries[id];
  if (!entry) {
    const item = await getItem(id);
    if (!item) return { status: "notfound" };
    const rejected = rejectRawItem(item);
    const submission = normalizeItem(item, []);
    if (rejected || !submission) return { status: "rejected", reason: rejected ?? "untitled", submission };
    const pre = prescoreOf(submission);
    entry = { submission, prescore: pre, status: pre.reject ? "rejected" : "pending", attempts: 0 };
    doc.entries[id] = entry;
    store.write(doc);
    if (pre.reject) return { status: "rejected", reason: pre.reject, submission };
  }
  if (entry.status === "rejected" && entry.prescore.reject) return { status: "rejected", reason: entry.prescore.reject as SubmissionRejectReason, submission: entry.submission };

  const fresh = entry.exploration && entry.exploration.version === BUILDER_VERSION;
  if (!fresh || entry.status === "pending" || (entry.status === "failed" && due(entry))) {
    entry = await buildEntry(id);
  }
  if (entry.exploration && (entry.status === "complete" || entry.status === "insufficient")) {
    return { status: entry.status, exploration: entry.exploration };
  }
  return { status: "failed", error: entry.error ?? "The rabbit hole could not be built.", submission: entry.submission };
}

/** Exposed for tests: writes pending data to disk. */
export function __flushHackerNewsStore(): Promise<void> {
  return store.flush();
}
