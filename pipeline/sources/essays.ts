import { createHash } from "node:crypto";
import { authorHasher, type Db } from "../db.ts";
import { fetchJson, politeFetch, robotsFor } from "../http.ts";
import { extractLinks } from "../text.ts";
import { saveMentions } from "./store.ts";

/**
 * Pages written to recommend Wikipedia articles. Each entry was read by a person
 * (or by Claude in a reviewed session) before being listed: the page's whole
 * purpose must be recommending articles, since every link on it counts. A page
 * is one discussion and one recommender, however many articles it lists, except
 * Discourse threads, whose posts have separate authors.
 */

export interface EssaySource {
  url: string;
  /** Shown as the source community. */
  community: string;
  title: string;
  /** Publication date from the page itself. */
  date: string;
  kind: "page" | "discourse" | "github-readme";
}

export const ESSAY_SOURCES: EssaySource[] = [
  {
    url: "https://austinhenley.com/blog/favwikiarticles.html",
    community: "austinhenley.com",
    title: "My favorite Wikipedia articles about science stuff",
    date: "2016-11-11",
    kind: "page",
  },
  {
    url: "https://boards.straightdope.com/t/link-me-to-interesting-wikipedia-pages/765915",
    community: "Straight Dope Message Board",
    title: "Link me to interesting Wikipedia pages",
    date: "2016-09-14",
    kind: "discourse",
  },
  {
    url: "https://boards.straightdope.com/t/most-interesting-wikipedia-articles/555335",
    community: "Straight Dope Message Board",
    title: "Most interesting Wikipedia articles",
    date: "2010-09-28",
    kind: "discourse",
  },
];

interface DiscourseThread {
  title: string;
  post_stream: { posts: Array<{ id: number; username: string; cooked: string; created_at: string; post_number: number }> };
}

export async function ingestEssays(db: Db, log: (message: string) => void = () => {}): Promise<number> {
  const hash = authorHasher(db);
  let total = 0;
  for (const essay of ESSAY_SOURCES) {
    const { origin, pathname } = new URL(essay.url);
    const robots = await robotsFor(origin);
    if (!robots.allowed(pathname)) {
      log(`skipped ${essay.url}: robots.txt disallows it`);
      continue;
    }
    const gapMs = Math.max(robots.crawlDelayMs ?? 0, 3000);
    const discussionId = `essay:${createHash("sha1").update(essay.url).digest("hex").slice(0, 16)}`;
    const base = {
      source: "essays",
      community: essay.community,
      kind: "essay" as const,
      discussionId,
      discussionUrl: essay.url,
      discussionTitle: essay.title,
      points: null,
      replies: null,
    };
    if (essay.kind === "discourse") {
      const thread = await fetchJson<DiscourseThread>(`${essay.url}.json`, { gapMs });
      for (const post of thread.post_stream.posts) {
        total += saveMentions(
          db,
          {
            ...base,
            itemId: `${discussionId}:${post.id}`,
            itemUrl: `${essay.url}/${post.post_number}`,
            authorHash: hash(origin, post.username),
            createdAt: Math.floor(Date.parse(post.created_at) / 1000),
          },
          extractLinks(post.cooked),
        );
      }
    } else {
      const html = await (await politeFetch(essay.url, { gapMs })).text();
      const body = html.replace(/<head[\s\S]*?<\/head>/i, "").replace(/<(script|style|nav|footer)\b[\s\S]*?<\/\1>/gi, "");
      total += saveMentions(
        db,
        {
          ...base,
          itemId: discussionId,
          itemUrl: essay.url,
          authorHash: hash(origin, origin),
          createdAt: Math.floor(Date.parse(`${essay.date}T00:00:00Z`) / 1000),
        },
        extractLinks(body),
      );
    }
    log(`${essay.url}: ${total} mentions so far`);
  }
  return total;
}
