import { authorHasher, getState, setState, transaction, type Db } from "../db.ts";
import { fetchJson, robotsFor } from "../http.ts";
import { extractLinks } from "../text.ts";
import { parseWikipediaUrl } from "@/lib/curated/links";
import { saveMentions } from "./store.ts";

/**
 * Lemmy's public API, reading !wikipedia@lemmy.world, a community that exists to
 * "share interesting articles from Wikipedia". lemmy.world's robots.txt asks for
 * a crawl delay, which sets the pace: this is a slow background job.
 */

const ORIGIN = "https://lemmy.world";
const COMMUNITY = "wikipedia";
const PAGE_SIZE = 50;

interface PostView {
  post: { id: number; name: string; url?: string | null; body?: string | null; published: string; removed?: boolean; deleted?: boolean; ap_id: string; nsfw?: boolean };
  creator: { actor_id: string };
  counts: { score: number; comments: number };
}

export async function ingestLemmy(db: Db, options: { maxPages?: number; log?: (message: string) => void } = {}): Promise<number> {
  const hash = authorHasher(db);
  const robots = await robotsFor(ORIGIN);
  const path = "/api/v3/post/list";
  if (!robots.allowed(path)) throw new Error(`robots.txt disallows ${ORIGIN}${path}`);
  const gapMs = Math.max(robots.crawlDelayMs ?? 0, 2000);
  let page = Number(getState(db, "lemmy:page")) || 1;
  let total = 0;
  for (let fetched = 0; fetched < (options.maxPages ?? Infinity); fetched++) {
    const url = `${ORIGIN}${path}?community_name=${COMMUNITY}&sort=New&limit=${PAGE_SIZE}&page=${page}`;
    const { posts } = await fetchJson<{ posts: PostView[] }>(url, { gapMs });
    if (posts.length === 0) {
      setState(db, "lemmy:page", 1);
      setState(db, "lemmy:complete", new Date().toISOString().slice(0, 10));
      break;
    }
    transaction(db, () => {
      for (const view of posts) {
        const { post, counts, creator } = view;
        if (post.removed || post.deleted) continue;
        const direct = post.url ? parseWikipediaUrl(post.url) : null;
        const links = direct
          ? [{ reference: direct, context: `Shared [[${direct.title}]] in a community for interesting Wikipedia articles, titled: ${post.name}`, excerpt: post.name.slice(0, 240), linksInText: 1, wordsInText: post.name.split(/\s+/).length }]
          : extractLinks(`${post.name}\n${post.body ?? ""}`).map((link) => ({ ...link, context: `Shared in a community for interesting Wikipedia articles: ${link.context}` }));
        total += saveMentions(
          db,
          {
            source: "lemmy",
            community: "!wikipedia@lemmy.world",
            kind: "submission",
            itemId: String(post.id),
            itemUrl: post.ap_id,
            discussionId: `lemmy:${post.id}`,
            discussionUrl: post.ap_id,
            discussionTitle: post.name,
            authorHash: hash("lemmy", creator.actor_id),
            createdAt: Math.floor(Date.parse(post.published) / 1000),
            points: counts.score,
            replies: counts.comments,
          },
          links,
        );
      }
      page += 1;
      setState(db, "lemmy:page", page);
    });
    options.log?.(`lemmy page ${page - 1}: ${total} mentions so far`);
  }
  return total;
}
