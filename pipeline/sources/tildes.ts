import { parse, type HTMLElement } from "node-html-parser";
import { parseWikipediaUrl } from "@/lib/curated/links";
import { authorHasher, getState, setState, transaction, type Db } from "../db.ts";
import { politeFetch, robotsFor } from "../http.ts";
import { extractLinks } from "../text.ts";
import { saveMentions } from "./store.ts";

/**
 * Tildes has no API. Its robots.txt welcomes scrapers "collecting data for
 * informational uses" at a reasonable rate, so we read public topic pages found
 * through its search, slowly, and keep only comments that link to Wikipedia.
 */

const ORIGIN = "https://tildes.net";
const GAP_MS = 3000;

async function page(pathAndQuery: string): Promise<HTMLElement> {
  const robots = await robotsFor(ORIGIN);
  if (!robots.allowed(pathAndQuery)) throw new Error(`robots.txt disallows ${pathAndQuery}`);
  const response = await politeFetch(`${ORIGIN}${pathAndQuery}`, { gapMs: Math.max(GAP_MS, robots.crawlDelayMs ?? 0) });
  return parse(await response.text());
}

function epoch(element: HTMLElement | null | undefined): number | null {
  const stamp = element?.getAttribute("datetime");
  const ms = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function topicPathsFromSearch(root: HTMLElement): string[] {
  const paths = new Set<string>();
  for (const anchor of root.querySelectorAll("a")) {
    const match = /^\/(~[a-z0-9._]+)\/([a-z0-9]+)\/[^/?#]+$/.exec(anchor.getAttribute("href") ?? "");
    if (match) paths.add(match[0]);
  }
  return [...paths];
}

export interface TildesTopicItem {
  id: string;
  html: string;
  author: string | null;
  createdAt: number;
}

/** The topic's own link, and each comment with its text. */
export function parseTopic(root: HTMLElement): { title: string; group: string; link: string | null; postedAt: number | null; author: string | null; comments: TildesTopicItem[] } {
  const article = root.querySelector("article.topic-full") ?? root;
  const title = article.querySelector("h1")?.text.trim() ?? "";
  const group = root.querySelector("a.link-group")?.text.trim() ?? "~";
  const link = article.querySelector(".topic-full-link a")?.getAttribute("href") ?? null;
  const comments: TildesTopicItem[] = [];
  for (const comment of root.querySelectorAll("article.comment")) {
    const id = comment.getAttribute("data-comment-id36");
    const text = comment.querySelector(":scope > .comment-itself .comment-text") ?? comment.querySelector(".comment-text");
    const createdAt = epoch(comment.querySelector("time"));
    if (!id || !text || createdAt === null) continue;
    comments.push({ id, html: text.innerHTML, author: comment.querySelector(".link-user")?.text.trim() ?? null, createdAt });
  }
  return {
    title,
    group,
    link,
    postedAt: epoch(article.querySelector("time")),
    author: article.getAttribute("data-topic-posted-by") ?? article.querySelector(".link-user")?.text.trim() ?? null,
    comments,
  };
}

export async function ingestTildes(db: Db, options: { maxTopics?: number; log?: (message: string) => void } = {}): Promise<number> {
  const hash = authorHasher(db);
  const seen = new Set<string>(JSON.parse(getState(db, "tildes:seen") ?? "[]") as string[]);
  let after = getState(db, "tildes:after");
  let total = 0;
  let topics = 0;
  for (;;) {
    const list = await page(`/search?q=wikipedia${after ? `&after=${after}` : ""}`);
    for (const path of topicPathsFromSearch(list)) {
      if (seen.has(path)) continue;
      if (topics >= (options.maxTopics ?? Infinity)) return total;
      const [, groupFromPath, topicId] = path.split("/");
      const topic = parseTopic(await page(path));
      const discussionUrl = `${ORIGIN}${path}`;
      const community = `Tildes ${groupFromPath}`;
      transaction(db, () => {
        const reference = topic.link ? parseWikipediaUrl(topic.link) : null;
        if (reference && topic.postedAt) {
          total += saveMentions(
            db,
            {
              source: "tildes",
              community,
              kind: "submission",
              itemId: topicId,
              itemUrl: discussionUrl,
              discussionId: `tildes:${topicId}`,
              discussionUrl,
              discussionTitle: topic.title,
              authorHash: hash("tildes", topic.author),
              createdAt: topic.postedAt,
              points: null,
              replies: topic.comments.length,
            },
            [{ reference, context: `Submitted [[${reference.title}]] with the title: ${topic.title}`, excerpt: topic.title.slice(0, 240), linksInText: 1, wordsInText: topic.title.split(/\s+/).length }],
          );
        }
        for (const comment of topic.comments) {
          total += saveMentions(
            db,
            {
              source: "tildes",
              community,
              kind: "comment",
              itemId: comment.id,
              itemUrl: `${discussionUrl}#comment-${comment.id}`,
              discussionId: `tildes:${topicId}`,
              discussionUrl,
              discussionTitle: topic.title,
              authorHash: hash("tildes", comment.author),
              createdAt: comment.createdAt,
              points: null,
              replies: null,
            },
            extractLinks(comment.html),
          );
        }
        seen.add(path);
        setState(db, "tildes:seen", JSON.stringify([...seen]));
      });
      topics++;
      options.log?.(`tildes ${path}: ${total} mentions so far`);
    }
    const next = list.querySelector('a[rel="next"]')?.getAttribute("href") ?? list.querySelectorAll("a").find((a) => a.getAttribute("href")?.includes("after="))?.getAttribute("href");
    const cursor = next ? new URL(next, ORIGIN).searchParams.get("after") : null;
    if (!cursor || cursor === after) {
      setState(db, "tildes:after", "");
      return total;
    }
    after = cursor;
    setState(db, "tildes:after", cursor);
  }
}
