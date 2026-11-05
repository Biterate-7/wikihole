import { parseWikipediaUrl } from "@/lib/curated/links";
import { authorHasher, getState, setState, transaction, type Db } from "../db.ts";
import { fetchJson } from "../http.ts";
import { decodeEntities, extractLinks, type LinkContext } from "../text.ts";
import { saveMentions, type ItemProvenance } from "./store.ts";

/**
 * Hacker News through the official Algolia search API (no key, 10,000 requests
 * per hour per IP; we stay near 1 per second). search_by_date is sorted newest
 * first and capped at 1,000 hits per query, so the walk moves a date cursor
 * instead of paging. The cursor is saved after every batch: an interrupted run
 * resumes, and a later run only fetches what is newer than its high-water mark.
 */

const API = "https://hn.algolia.com/api/v1/search_by_date";
const PAGE_SIZE = 1000;

interface Hit {
  objectID: string;
  created_at_i: number;
  author?: string;
  title?: string | null;
  url?: string | null;
  points?: number | null;
  num_comments?: number | null;
  comment_text?: string | null;
  story_id?: number | null;
  story_title?: string | null;
}

interface SearchResponse {
  hits: Hit[];
}

const itemUrl = (id: string | number) => `https://news.ycombinator.com/item?id=${id}`;

export function linksFromComment(hit: Hit): LinkContext[] {
  return hit.comment_text ? extractLinks(hit.comment_text) : [];
}

export function linksFromStory(hit: Hit): LinkContext[] {
  const reference = hit.url ? parseWikipediaUrl(hit.url) : null;
  if (!reference) return [];
  const title = decodeEntities(hit.title ?? "");
  return [
    {
      reference,
      context: `Submitted [[${reference.title}]] with the title: ${title}`,
      excerpt: title.slice(0, 240),
      linksInText: 1,
      wordsInText: title.split(/\s+/).filter(Boolean).length,
    },
  ];
}

type Kind = "comment" | "story";

function provenance(hit: Hit, kind: Kind, hash: ReturnType<typeof authorHasher>): ItemProvenance {
  const storyId = kind === "story" ? hit.objectID : String(hit.story_id ?? hit.objectID);
  return {
    source: "hackernews",
    community: "Hacker News",
    kind: kind === "story" ? "submission" : "comment",
    itemId: hit.objectID,
    itemUrl: itemUrl(hit.objectID),
    discussionId: `hn:${storyId}`,
    discussionUrl: itemUrl(storyId),
    discussionTitle: decodeEntities((kind === "story" ? hit.title : hit.story_title) ?? "") || null,
    authorHash: hash("hackernews", hit.author),
    createdAt: hit.created_at_i,
    points: hit.points ?? null,
    replies: hit.num_comments ?? null,
  };
}

function queryUrl(kind: Kind, before: number | null, after: number | null): string {
  const params = new URLSearchParams({
    query: "wikipedia.org",
    tags: kind,
    hitsPerPage: String(PAGE_SIZE),
    typoTolerance: "false",
    attributesToHighlight: "",
    attributesToRetrieve:
      kind === "story" ? "title,url,points,num_comments,created_at_i,author" : "comment_text,story_id,story_title,created_at_i,author,points",
  });
  if (kind === "story") params.set("restrictSearchableAttributes", "url");
  const filters = [before !== null ? `created_at_i<=${before}` : null, after !== null ? `created_at_i>${after}` : null].filter(Boolean);
  if (filters.length) params.set("numericFilters", filters.join(","));
  return `${API}?${params}`;
}

export interface HnProgress {
  kind: Kind;
  items: number;
  mentions: number;
  cursor: number | null;
}

/**
 * Walks one kind from the newest item (or the saved cursor) down to the
 * high-water mark of the last completed walk. The mark only advances once a
 * walk finishes, so an interruption can never leave a gap behind it.
 */
export async function ingestHackerNews(
  db: Db,
  kind: Kind,
  options: { maxPages?: number; onProgress?: (p: HnProgress) => void } = {},
): Promise<HnProgress> {
  const hash = authorHasher(db);
  const cursorKey = `hn:${kind}:cursor`;
  const walkTopKey = `hn:${kind}:walk-top`;
  const markKey = `hn:${kind}:complete-through`;
  const mark = Number(getState(db, markKey)) || null;
  let cursor = Number(getState(db, cursorKey)) || null;
  let walkTop = Number(getState(db, walkTopKey)) || null;
  const progress: HnProgress = { kind, items: 0, mentions: 0, cursor };

  for (let page = 0; page < (options.maxPages ?? Infinity); page++) {
    const { hits } = await fetchJson<SearchResponse>(queryUrl(kind, cursor, mark), { gapMs: 1000 });
    if (hits.length === 0) {
      // Walk finished: everything down to the old mark is stored.
      transaction(db, () => {
        if (walkTop) setState(db, markKey, walkTop);
        db.prepare("DELETE FROM state WHERE key IN (?, ?)").run(cursorKey, walkTopKey);
      });
      progress.cursor = null;
      break;
    }
    const oldest = hits.at(-1)!.created_at_i;
    walkTop ??= hits[0].created_at_i;
    const walkTopValue = walkTop;
    transaction(db, () => {
      for (const hit of hits) {
        const links = kind === "story" ? linksFromStory(hit) : linksFromComment(hit);
        progress.mentions += saveMentions(db, provenance(hit, kind, hash), links);
      }
      setState(db, walkTopKey, walkTopValue);
      // A full page may stop mid-second: step back only when the page was short of a new second.
      setState(db, cursorKey, hits.length < PAGE_SIZE ? oldest - 1 : oldest === cursor ? oldest - 1 : oldest);
    });
    cursor = Number(getState(db, cursorKey));
    progress.items += hits.length;
    progress.cursor = cursor;
    options.onProgress?.(progress);
  }
  return progress;
}
