import "server-only";
import { getItems, getStoryIds, HackerNewsError } from "./client";
import { htmlToText, normalizeItem } from "./normalization";
import type { HnList, Submission } from "./types";

/**
 * Discovery of candidate submissions from the Hacker News lists. Ids are
 * de-duplicated across lists (a story is often in top, best and show at
 * once) and each item is fetched once; the client caches lists for a few
 * minutes and items for longer, so repeated ingestion costs little.
 */

export const INGEST_LISTS: Array<{ list: HnList; take: number }> = [
  { list: "top", take: 60 },
  { list: "best", take: 40 },
  { list: "show", take: 30 },
  { list: "ask", take: 25 },
  { list: "new", take: 30 },
];

export interface IngestResult {
  submissions: Submission[];
  failedLists: HnList[];
  failedItems: number;
}

export async function discoverSubmissions(lists = INGEST_LISTS): Promise<IngestResult> {
  const settled = await Promise.allSettled(lists.map(({ list }) => getStoryIds(list)));
  const membership = new Map<number, HnList[]>();
  const failedLists: HnList[] = [];
  settled.forEach((result, i) => {
    const { list, take } = lists[i];
    if (result.status === "rejected") {
      failedLists.push(list);
      return;
    }
    for (const id of result.value.slice(0, take)) membership.set(id, [...(membership.get(id) ?? []), list]);
  });
  if (failedLists.length === lists.length) {
    const first = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    throw first?.reason ?? new HackerNewsError("Hacker News is unavailable", "network");
  }

  const { items, failed } = await getItems([...membership.keys()]);
  const now = Date.now();
  const submissions = items.flatMap((item) => {
    const submission = normalizeItem(item, membership.get(item.id) ?? [], now);
    return submission ? [submission] : [];
  });
  return { submissions, failedLists, failedItems: failed.length };
}

/**
 * Plain text of the first top-level comments that are still live. Used only
 * as context for entity extraction; comments are never displayed.
 */
export async function topComments(submission: Submission, count = 5): Promise<string[]> {
  if (submission.kids.length === 0) return [];
  try {
    const { items } = await getItems(submission.kids.slice(0, count + 3));
    return items
      .filter((c) => c.type === "comment" && !c.deleted && !c.dead && c.text)
      .slice(0, count)
      .flatMap((c) => {
        const text = htmlToText(c.text);
        return text ? [text.slice(0, 1500)] : [];
      });
  } catch {
    // Context is optional: build from the submission alone.
    return [];
  }
}
