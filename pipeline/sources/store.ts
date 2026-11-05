import type { Db } from "../db.ts";
import type { LinkContext } from "../text.ts";

export type MentionKind = "comment" | "submission" | "essay";

export interface ItemProvenance {
  source: string;
  community: string;
  kind: MentionKind;
  itemId: string;
  itemUrl: string;
  discussionId: string;
  discussionUrl: string;
  discussionTitle: string | null;
  authorHash: string | null;
  createdAt: number;
  points: number | null;
  replies: number | null;
}

/** Inserts or refreshes the mentions from one item. Classification and review survive a re-ingest. */
export function saveMentions(db: Db, item: ItemProvenance, links: LinkContext[]): number {
  if (links.length === 0) return 0;
  const insert = db.prepare(`
    INSERT INTO mentions (id, source, community, kind, item_url, discussion_id, discussion_url, discussion_title,
      author_hash, created_at, points, replies, lang, raw_title, raw_url_fragment, context, excerpt, links_in_text, words_in_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET points = excluded.points, replies = excluded.replies, discussion_title = excluded.discussion_title
  `);
  for (const link of links) {
    const { lang, title, fragment } = link.reference;
    insert.run(
      `${item.source}:${item.itemId}:${lang}:${title}`,
      item.source,
      item.community,
      item.kind,
      item.itemUrl,
      item.discussionId,
      item.discussionUrl,
      item.discussionTitle,
      item.authorHash,
      item.createdAt,
      item.points,
      item.replies,
      lang,
      title,
      fragment ?? null,
      link.context,
      link.excerpt,
      link.linksInText,
      link.wordsInText,
    );
  }
  return links.length;
}
