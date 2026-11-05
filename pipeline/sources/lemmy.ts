import { authorHasher, getState, setState, transaction, type Db } from "../db.ts";
import { fetchJson, robotsFor } from "../http.ts";
import { titlesOverlap } from "../classify/heuristic.ts";
import { extractLinks, type LinkContext } from "../text.ts";
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
/** The API answers HTTP 400 past this page, so newest-first can only reach this many pages of posts. */
const MAX_PAGE = 100;

interface PostView {
  post: { id: number; name: string; url?: string | null; body?: string | null; published: string; removed?: boolean; deleted?: boolean; ap_id: string; nsfw?: boolean };
  creator: { actor_id: string };
  counts: { score: number; comments: number };
}

/**
 * A post whose image is the link and whose body pastes the article's intro carries
 * every link in that intro. Only the article the post is about counts.
 */
export function subjectLinks(name: string, body: string): LinkContext[] {
  const links = extractLinks(`${name}\n${body}`);
  const subject = links.find((link) => titlesOverlap(link.reference.title, name)) ?? links[0];
  return subject ? [{ ...subject, context: `Shared in a community for interesting Wikipedia articles: ${subject.context}`, linksInText: 1 }] : [];
}

/**
 * Walks newest first as far as the API allows, then oldest first until it meets
 * what it has already read, which reaches a community larger than the page limit.
 */
export async function ingestLemmy(db: Db, options: { maxPages?: number; maxPage?: number; minGapMs?: number; log?: (message: string) => void } = {}): Promise<number> {
  const hash = authorHasher(db);
  const robots = await robotsFor(ORIGIN);
  const path = "/api/v3/post/list";
  if (!robots.allowed(path)) throw new Error(`robots.txt disallows ${ORIGIN}${path}`);
  const gapMs = Math.max(robots.crawlDelayMs ?? 0, options.minGapMs ?? 2000);
  const maxPage = options.maxPage ?? MAX_PAGE;
  let page = Number(getState(db, "lemmy:page")) || 1;
  let sort = getState(db, "lemmy:sort") === "Old" ? "Old" : "New";
  let oldestBefore = Number(getState(db, "lemmy:old-before")) || 0;
  let total = 0;
  const finish = () => {
    setState(db, "lemmy:page", 1);
    setState(db, "lemmy:sort", "New");
    setState(db, "lemmy:complete", new Date().toISOString().slice(0, 10));
  };
  for (let fetched = 0; fetched < (options.maxPages ?? Infinity); fetched++) {
    if (sort === "New" && page > maxPage) {
      const oldest = db.prepare("SELECT min(created_at) AS at FROM mentions WHERE source = 'lemmy'").get() as { at: number | null };
      oldestBefore = oldest.at ?? Number.MAX_SAFE_INTEGER;
      sort = "Old";
      page = 1;
      setState(db, "lemmy:sort", sort);
      setState(db, "lemmy:old-before", oldestBefore);
      setState(db, "lemmy:page", page);
    }
    const url = `${ORIGIN}${path}?community_name=${COMMUNITY}&sort=${sort}&limit=${PAGE_SIZE}&page=${page}`;
    const { posts } = await fetchJson<{ posts: PostView[] }>(url, { gapMs });
    if (posts.length === 0) {
      finish();
      break;
    }
    const metKnown = sort === "Old" && posts.some((view) => Date.parse(view.post.published) / 1000 >= oldestBefore);
    transaction(db, () => {
      for (const view of posts) {
        const { post, counts, creator } = view;
        if (post.removed || post.deleted) continue;
        const direct = post.url ? parseWikipediaUrl(post.url) : null;
        const links = direct
          ? [{ reference: direct, context: `Shared [[${direct.title}]] in a community for interesting Wikipedia articles, titled: ${post.name}`, excerpt: post.name.slice(0, 240), linksInText: 1, wordsInText: post.name.split(/\s+/).length }]
          : subjectLinks(post.name, post.body ?? "");
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
    options.log?.(`lemmy ${sort} page ${page - 1}: ${total} mentions so far`);
    if (metKnown) {
      finish();
      break;
    }
  }
  return total;
}
