"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Icon } from "@/components/ui/Icon";
import { SaveButton } from "@/components/ui/SaveButton";
import type { Discovery } from "@/lib/discovery/types";
import { leadSentences } from "@/lib/format";
import { currentTrailStore, historyStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./article.module.css";

const DEEPER = new Set(["see-also", "lead-link"]);

function RelatedCard({ item, visited }: { item: Discovery; visited: boolean }) {
  return (
    <li className={styles.related} data-testid="related-item">
      <p className={`label ${styles.relation}`}>{item.relation?.label ?? "Related"}</p>
      <h3 className={styles.relatedTitle}>
        <Link href={articlePath(item.title)}>{item.title}</Link>
        {visited ? <span className={`label ${styles.visitedTag}`}>Visited</span> : null}
      </h3>
      {item.description ? <p className={styles.relatedDesc}>{item.description}</p> : null}
      <p className={styles.relatedExtract}>{leadSentences(item.extract, 200)}</p>
      <div className={styles.relatedMeta}>
        <span className="label">{item.readingMinutes} min</span>
        <SaveButton
          article={{
            title: item.title,
            description: item.description,
            extract: leadSentences(item.extract, 300),
            thumbnail: item.thumbnail,
            readingMinutes: item.readingMinutes,
            groupLabel: item.groupLabel,
          }}
        />
        <Link href={articlePath(item.title)} className="action" aria-label={`Go deeper into ${item.title}`}>
          Go deeper <Icon name="arrow-right" size={11} />
        </Link>
      </div>
    </li>
  );
}

/**
 * Related discoveries for the Rabbit Hole. Articles already on the current
 * trail are hidden; previously read ones sink to the end and are marked.
 */
export function RelatedList({ items, currentTitle }: { items: Discovery[]; currentTitle: string }) {
  const hydrated = useHydrated();
  const history = useStore(historyStore);
  const trail = useStore(currentTrailStore);

  const { deeper, adjacent, visited } = useMemo(() => {
    const visitedSet = new Set(hydrated ? history.map((h) => h.title) : []);
    const onTrail = new Set(hydrated ? (trail?.steps ?? []) : []);
    const candidates = items.filter((i) => i.title !== currentTitle && !onTrail.has(i.title));
    const ordered = [...candidates].sort((a, b) => Number(visitedSet.has(a.title)) - Number(visitedSet.has(b.title)));
    return {
      deeper: ordered.filter((i) => i.relation && DEEPER.has(i.relation.kind)),
      adjacent: ordered.filter((i) => !i.relation || !DEEPER.has(i.relation.kind)),
      visited: visitedSet,
    };
  }, [items, currentTitle, history, trail, hydrated]);

  if (deeper.length + adjacent.length === 0) {
    return <p className={styles.muted}>No related articles passed the quality gate for this page.</p>;
  }

  return (
    <div className={styles.relatedGroups}>
      {deeper.length ? (
        <div>
          <h3 className="label">Go deeper: linked from this article</h3>
          <ul className={styles.relatedList}>
            {deeper.map((item) => (
              <RelatedCard key={item.pageId} item={item} visited={visited.has(item.title)} />
            ))}
          </ul>
        </div>
      ) : null}
      {adjacent.length ? (
        <div>
          <h3 className="label">Adjacent: shared categories and similar text</h3>
          <ul className={styles.relatedList}>
            {adjacent.map((item) => (
              <RelatedCard key={item.pageId} item={item} visited={visited.has(item.title)} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
