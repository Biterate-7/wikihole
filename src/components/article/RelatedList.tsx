"use client";

import Link from "next/link";
import { useMemo } from "react";
import { SaveButton } from "@/components/ui/SaveButton";
import { ThumbImage } from "@/components/ui/ThumbImage";
import type { Discovery } from "@/lib/discovery/types";
import { leadSentences } from "@/lib/format";
import { currentTrailStore, historyStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./article.module.css";

const DEEPER = new Set(["see-also", "lead-link"]);
const PEOPLE = new Set(["co-recommended", "reader-path"]);

/** A related article, laid out like a Wikipedia search result: title, source of the link, description, intro. */
function RelatedEntry({ item, visited }: { item: Discovery; visited: boolean }) {
  const href = articlePath(item.title, undefined, item.lang);
  return (
    <li className={styles.related} data-testid="related-item">
      {item.thumbnail ? (
        <Link href={href} className={styles.relatedThumb} tabIndex={-1} aria-hidden="true">
          <ThumbImage thumbnail={item.thumbnail} size={64} />
        </Link>
      ) : null}
      <div className={styles.relatedBody}>
        <p className={`label ${styles.relation}`} title={item.relation?.evidence}>
          {item.relation?.label ?? "Related"}
          {item.recommended ? ` · Recommended ${item.recommended.qualifying} ${item.recommended.qualifying === 1 ? "time" : "times"} in discussions` : ""}
        </p>
        <h3 className={styles.relatedTitle}>
          <Link href={href}>{item.title}</Link>
          {visited ? <span className={styles.visitedTag}>Visited</span> : null}
        </h3>
        {item.description ? <p className={styles.relatedDesc}>{item.description}</p> : null}
        <p className={styles.relatedExtract}>{leadSentences(item.extract, 200)}</p>
        <div className={styles.relatedMeta}>
          <span>{item.readingMinutes} min read</span>
          <span className="dot" />
          <SaveButton
            article={{
              title: item.title,
              description: item.description,
              extract: leadSentences(item.extract, 300),
              thumbnail: item.thumbnail,
              readingMinutes: item.readingMinutes,
              groupLabel: item.groupLabel,
              ...(item.lang ? { lang: item.lang } : {}),
            }}
          />
          <span className="dot" />
          <Link href={href} className="action" aria-label={`Go deeper into ${item.title}`}>
            Go deeper
          </Link>
        </div>
      </div>
    </li>
  );
}

/**
 * Related discoveries for the Rabbit Hole. Articles already on the current
 * trail are hidden; previously read ones sink to the end and are marked.
 */
export function RelatedList({
  items,
  currentTitle,
  lang = DEFAULT_LANGUAGE,
}: {
  items: Discovery[];
  currentTitle: string;
  lang?: string;
}) {
  const hydrated = useHydrated();
  const history = useStore(historyStore);
  const trail = useStore(currentTrailStore);

  const { deeper, people, adjacent, visited } = useMemo(() => {
    const sameEdition = (entry: { lang?: string } | null | undefined) => (entry?.lang ?? DEFAULT_LANGUAGE) === lang;
    const visitedSet = new Set(hydrated ? history.filter(sameEdition).map((h) => h.title) : []);
    const onTrail = new Set(hydrated && sameEdition(trail) ? (trail?.steps ?? []) : []);
    const candidates = items.filter((i) => i.title !== currentTitle && !onTrail.has(i.title));
    const ordered = [...candidates].sort((a, b) => Number(visitedSet.has(a.title)) - Number(visitedSet.has(b.title)));
    return {
      deeper: ordered.filter((i) => i.relation && DEEPER.has(i.relation.kind)),
      people: ordered.filter((i) => i.relation && PEOPLE.has(i.relation.kind)),
      adjacent: ordered.filter((i) => !i.relation || (!DEEPER.has(i.relation.kind) && !PEOPLE.has(i.relation.kind))),
      visited: visitedSet,
    };
  }, [items, currentTitle, history, trail, hydrated, lang]);

  if (deeper.length + people.length + adjacent.length === 0) {
    return <p className={styles.muted}>No related articles passed the quality gate for this page.</p>;
  }

  return (
    <div className={styles.relatedGroups}>
      {deeper.length ? (
        <div>
          <h3 className={styles.h3}>Go deeper: linked from this article</h3>
          <ul className={styles.relatedList}>
            {deeper.map((item) => (
              <RelatedEntry key={item.pageId} item={item} visited={visited.has(item.title)} />
            ))}
          </ul>
        </div>
      ) : null}
      {people.length ? (
        <div>
          <h3 className={styles.h3}>Also read: what people and readers pair with this article</h3>
          <ul className={styles.relatedList}>
            {people.map((item) => (
              <RelatedEntry key={item.pageId} item={item} visited={visited.has(item.title)} />
            ))}
          </ul>
        </div>
      ) : null}
      {adjacent.length ? (
        <div>
          <h3 className={styles.h3}>Adjacent: shared categories and similar text</h3>
          <ul className={styles.relatedList}>
            {adjacent.map((item) => (
              <RelatedEntry key={item.pageId} item={item} visited={visited.has(item.title)} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
