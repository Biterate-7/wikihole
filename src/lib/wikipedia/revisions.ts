import "server-only";
import { z } from "zod";
import { TtlCache } from "@/lib/cache";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { parseCompareBody } from "./diff";
import { coreRestUrlFor, fetchJson, mwApi, WikipediaError } from "./http";
import type {
  ArticleHistory,
  Contributor,
  EditSummary,
  HistoryCount,
  RecentActivity,
  Revision,
  RevisionComparison,
  RevisionPage,
  RevisionSide,
} from "./types";

/**
 * Revision history from Wikimedia: the Action API for revisions and diffs,
 * and the core REST API for lifetime counts. Everything here is reported as
 * Wikimedia returned it; a part it does not supply stays null and is left out
 * of the page rather than estimated.
 */

const revisionSchema = z.object({
  revid: z.number(),
  parentid: z.number().optional(),
  timestamp: z.string().optional(),
  user: z.string().optional(),
  anon: z.boolean().optional(),
  temp: z.boolean().optional(),
  userhidden: z.boolean().optional(),
  comment: z.string().optional(),
  commenthidden: z.boolean().optional(),
  size: z.number().optional(),
  minor: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
type RawRevision = z.infer<typeof revisionSchema>;

const revisionsResponseSchema = z.object({
  query: z
    .object({
      pages: z.array(
        z.object({
          missing: z.boolean().optional(),
          revisions: z.array(revisionSchema).optional(),
        }),
      ),
    })
    .optional(),
});

const countSchema = z.object({ count: z.number(), limit: z.boolean().optional() });

const compareResponseSchema = z.object({
  compare: z
    .object({
      fromrevid: z.number().optional(),
      fromtitle: z.string().optional(),
      fromsize: z.number().optional(),
      fromtimestamp: z.string().optional(),
      fromuser: z.string().optional(),
      fromtemp: z.boolean().optional(),
      fromanon: z.boolean().optional(),
      fromuserhidden: z.boolean().optional(),
      fromcomment: z.string().optional(),
      fromcommenthidden: z.boolean().optional(),
      torevid: z.number(),
      totitle: z.string().optional(),
      tosize: z.number().optional(),
      totimestamp: z.string().optional(),
      touser: z.string().optional(),
      totemp: z.boolean().optional(),
      toanon: z.boolean().optional(),
      touserhidden: z.boolean().optional(),
      tocomment: z.string().optional(),
      tocommenthidden: z.boolean().optional(),
      prev: z.number().optional(),
      next: z.number().optional(),
      body: z.string().optional(),
    })
    .optional(),
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Recent edits change often, lifetime counts slowly; a page's first revision and any stored diff almost never. */
const pageCache = new TtlCache<RevisionPage>(500, 5 * MINUTE);
const countCache = new TtlCache<HistoryCount>(2000, HOUR);
const createdCache = new TtlCache<NonNullable<ArticleHistory["created"]>>(2000, 7 * DAY);
const compareCache = new TtlCache<RevisionComparison>(500, DAY);

/** History is secondary to the article: fail fast and let the page go without it. */
const HISTORY_REQUEST = { timeoutMs: 5000, retries: 1 };

export const RECENT_REVISIONS = 50;
export const ACTIVITY_DAYS = 30;

function wikilinksToText(text: string): string {
  return text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1");
}

/** Splits MediaWiki's section marker from an edit summary and flattens its wikilinks. */
export function parseEditSummary(comment: string | undefined): EditSummary | null {
  if (!comment) return null;
  const match = comment.match(/^\s*\/\*\s*(.*?)\s*\*\/\s*:?\s*(.*)$/s);
  const section = match ? match[1] : undefined;
  const text = wikilinksToText(match ? match[2] : comment).trim();
  if (!section && !text) return null;
  return section ? { section, text } : { text };
}

function toContributor(raw: { user?: string; anon?: boolean; temp?: boolean; hidden?: boolean }): Contributor {
  if (raw.hidden || !raw.user) return { kind: "hidden" };
  if (raw.anon) return { kind: "anonymous" };
  if (raw.temp) return { kind: "temporary", name: raw.user };
  return { kind: "registered", name: raw.user };
}

function toRevision(raw: RawRevision, parent: RawRevision | undefined): Revision {
  const parentId = raw.parentid ?? 0;
  const size = raw.size ?? 0;
  let sizeDelta: number | null = null;
  if (raw.size !== undefined) {
    if (parentId === 0) sizeDelta = size;
    else if (parent?.revid === parentId && parent.size !== undefined) sizeDelta = size - parent.size;
  }
  return {
    id: raw.revid,
    parentId,
    timestamp: raw.timestamp ?? "",
    contributor: toContributor({ user: raw.user, anon: raw.anon, temp: raw.temp, hidden: raw.userhidden }),
    summary: raw.commenthidden ? null : parseEditSummary(raw.comment),
    summaryHidden: Boolean(raw.commenthidden),
    size,
    sizeDelta,
    minor: Boolean(raw.minor),
    reverted: raw.tags?.includes("mw-reverted") ?? false,
  };
}

/**
 * A page of revisions, newest first. One extra revision is requested so the
 * last row's size change can be worked out, and it becomes the next page's start.
 */
export async function getRevisionPage(
  title: string,
  lang: string = DEFAULT_LANGUAGE,
  { from, limit = RECENT_REVISIONS }: { from?: number; limit?: number } = {},
): Promise<RevisionPage> {
  return pageCache.getOrLoad(`${lang}|${title}|${from ?? "latest"}|${limit}`, async () => {
    const raw = await mwApi(
      {
        action: "query",
        prop: "revisions",
        titles: title,
        rvprop: "ids|timestamp|user|size|comment|flags|tags",
        rvlimit: limit + 1,
        rvstartid: from,
      },
      { lang, ...HISTORY_REQUEST },
    );
    const parsed = revisionsResponseSchema.safeParse(raw);
    if (!parsed.success) throw new WikipediaError("Wikipedia returned malformed revision data", "invalid");
    const page = parsed.data.query?.pages[0];
    if (!page || page.missing) throw new WikipediaError("Wikipedia resource not found", "notfound", 404);
    const revisions = page.revisions ?? [];
    return {
      revisions: revisions.slice(0, limit).map((r, i) => toRevision(r, revisions[i + 1])),
      ...(revisions.length > limit ? { olderFrom: revisions[limit].revid } : {}),
    };
  });
}

async function getCount(title: string, kind: "edits" | "editors", lang: string): Promise<HistoryCount> {
  return countCache.getOrLoad(`${lang}|${title}|${kind}`, async () => {
    const page = encodeURIComponent(title.replace(/ /g, "_"));
    const raw = await fetchJson(`${coreRestUrlFor(lang)}/page/${page}/history/counts/${kind}`, HISTORY_REQUEST);
    const parsed = countSchema.safeParse(raw);
    if (!parsed.success) throw new WikipediaError("Wikipedia returned malformed history counts", "invalid");
    return { count: parsed.data.count, capped: Boolean(parsed.data.limit) };
  });
}

async function getCreated(title: string, lang: string): Promise<NonNullable<ArticleHistory["created"]>> {
  return createdCache.getOrLoad(`${lang}|${title}`, async () => {
    const raw = await mwApi(
      { action: "query", prop: "revisions", titles: title, rvprop: "ids|timestamp|user", rvlimit: 1, rvdir: "newer" },
      { lang, ...HISTORY_REQUEST },
    );
    const parsed = revisionsResponseSchema.safeParse(raw);
    const first = parsed.success ? parsed.data.query?.pages[0]?.revisions?.[0] : undefined;
    if (!first?.timestamp) throw new WikipediaError("Wikipedia did not report the first revision", "invalid");
    return {
      timestamp: first.timestamp,
      contributor: toContributor({ user: first.user, anon: first.anon, temp: first.temp, hidden: first.userhidden }),
    };
  });
}

/** Edit activity in the last `days` days, worked out from the revisions in hand. */
export function summariseActivity(page: RevisionPage, now: number, days = ACTIVITY_DAYS): RecentActivity {
  const since = now - days * DAY;
  const inWindow = page.revisions.filter((r) => Date.parse(r.timestamp) >= since);
  const reachedWindowStart = inWindow.length < page.revisions.length || page.olderFrom === undefined;
  const contributors = new Set(inWindow.map((r) => r.contributor.name ?? `${r.contributor.kind}:${r.id}`));
  let bytesAdded = 0;
  let bytesRemoved = 0;
  for (const revision of inWindow) {
    if ((revision.sizeDelta ?? 0) > 0) bytesAdded += revision.sizeDelta ?? 0;
    else bytesRemoved -= revision.sizeDelta ?? 0;
  }
  return { days, edits: inWindow.length, complete: reachedWindowStart, contributors: contributors.size, bytesAdded, bytesRemoved };
}

async function settled<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

/**
 * The article's history for the reader. Each part is fetched and cached on its
 * own, so one failing or rate-limited call only removes that part from the page.
 */
export async function getArticleHistory(title: string, lang: string = DEFAULT_LANGUAGE, now = Date.now()): Promise<ArticleHistory> {
  const [edits, contributors, created, page] = await Promise.all([
    settled(getCount(title, "edits", lang)),
    settled(getCount(title, "editors", lang)),
    settled(getCreated(title, lang)),
    settled(getRevisionPage(title, lang)),
  ]);
  return {
    edits,
    contributors,
    created,
    recent: page?.revisions ?? null,
    activity: page ? summariseActivity(page, now) : null,
  };
}

function toSide(raw: {
  id: number;
  timestamp?: string;
  user?: string;
  anon?: boolean;
  temp?: boolean;
  hidden?: boolean;
  comment?: string;
  commentHidden?: boolean;
  size?: number;
}): RevisionSide {
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    contributor: toContributor({ user: raw.user, anon: raw.anon, temp: raw.temp, hidden: raw.hidden }),
    summary: raw.commentHidden ? null : parseEditSummary(raw.comment),
    summaryHidden: Boolean(raw.commentHidden),
    size: raw.size,
  };
}

/** Thrown for revisions that exist but belong to another article. */
export class ComparisonError extends Error {}

/**
 * Compares two revisions with Wikimedia's compare API. Without `from`, compares
 * `to` with its parent, which is what one edit changed. Stored revisions do not
 * change, so results are cached for a long time.
 */
export async function compareRevisions(
  title: string,
  to: number,
  from: number | undefined,
  lang: string = DEFAULT_LANGUAGE,
): Promise<RevisionComparison> {
  return compareCache.getOrLoad(`${lang}|${title}|${from ?? "prev"}|${to}`, async () => {
    const raw = await mwApi(
      {
        action: "compare",
        ...(from === undefined ? { fromrev: to, torelative: "prev" } : { fromrev: from, torev: to }),
        prop: "diff|rel|ids|title|user|comment|size|timestamp",
      },
      { lang, timeoutMs: 10000, retries: 1 },
    );
    const parsed = compareResponseSchema.safeParse(raw);
    const compare = parsed.success ? parsed.data.compare : undefined;
    if (!compare) throw new WikipediaError("Wikipedia returned malformed comparison data", "invalid");
    if ((compare.totitle && compare.totitle !== title) || (compare.fromtitle && compare.fromtitle !== title)) {
      throw new ComparisonError("Those revisions belong to a different article.");
    }
    const diff = parseCompareBody(compare.body ?? "");
    return {
      title,
      from:
        compare.fromrevid === undefined
          ? null
          : toSide({
              id: compare.fromrevid,
              timestamp: compare.fromtimestamp,
              user: compare.fromuser,
              anon: compare.fromanon,
              temp: compare.fromtemp,
              hidden: compare.fromuserhidden,
              comment: compare.fromcomment,
              commentHidden: compare.fromcommenthidden,
              size: compare.fromsize,
            }),
      to: toSide({
        id: compare.torevid,
        timestamp: compare.totimestamp,
        user: compare.touser,
        anon: compare.toanon,
        temp: compare.totemp,
        hidden: compare.touserhidden,
        comment: compare.tocomment,
        commentHidden: compare.tocommenthidden,
        size: compare.tosize,
      }),
      ...(compare.prev !== undefined ? { olderId: compare.prev } : {}),
      ...(compare.next !== undefined ? { newerId: compare.next } : {}),
      ...diff,
    };
  });
}

/** Exposed for tests. */
export function __clearRevisionCaches(): void {
  for (const cache of [pageCache, countCache, createdCache, compareCache]) cache.clear();
}
