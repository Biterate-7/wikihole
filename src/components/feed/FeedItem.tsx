"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { SaveButton } from "@/components/ui/SaveButton";
import { ThumbImage } from "@/components/ui/ThumbImage";
import type { Discovery } from "@/lib/discovery/types";
import { ASSESSMENT_LABELS, assessmentBadge, formatCount, leadSentences, pad2 } from "@/lib/format";
import { articlePath } from "@/lib/wikipedia/titles";
import { PAGEVIEW_DAYS } from "@/lib/wikipedia/types";
import { ScoreBreakdown } from "./ScoreBreakdown";
import styles from "./feed.module.css";

export function FeedItem({ item, rank, visited }: { item: Discovery; rank: number; visited?: boolean }) {
  const [open, setOpen] = useState(false);
  const badge = assessmentBadge(item.assessment);
  const kicker = [item.groupLabel, item.subtopicLabel].filter(Boolean).join(" · ");
  const breakdownId = `why-${item.pageId}`;

  return (
    <article className={styles.item} data-testid="feed-item" data-title={item.title}>
      <div className={styles.rank} aria-hidden="true">
        {pad2(rank)}
      </div>
      <div className={styles.body}>
        {kicker ? <p className={`label ${styles.kicker}`}>{kicker}</p> : null}
        <h2 className={styles.title}>
          <Link href={articlePath(item.title)} className={styles.titleLink}>
            {item.title}
          </Link>
          {visited ? <span className={`label ${styles.visited}`}>Read</span> : null}
        </h2>
        {item.description ? <p className={styles.description}>{item.description}</p> : null}
        <p className={styles.extract}>{leadSentences(item.extract, 300)}</p>

        <div className={styles.meta}>
          <span>{item.readingMinutes} min read</span>
          {item.date ? (
            <span className="dot" title={`From Wikipedia category “${item.date.sourceCategory}”`}>
              {item.date.label} {item.date.year}
            </span>
          ) : null}
          {badge ? (
            <span className={`dot ${styles.badge}`} title={ASSESSMENT_LABELS[item.assessment ?? "Other"]}>
              {badge}
            </span>
          ) : null}
          {item.recentViews !== null ? (
            <span className="dot" title={`Pageviews over the last ${PAGEVIEW_DAYS} days`}>
              {formatCount(item.recentViews)} views/{PAGEVIEW_DAYS}d
            </span>
          ) : null}
          <a className="dot" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} on Wikipedia (opens in new tab)`}>
            Wikipedia <Icon name="arrow-up-right" size={10} />
          </a>
        </div>

        <div className={styles.actions}>
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
          <Link href={`${articlePath(item.title)}#rabbit-hole`} className="action">
            Rabbit hole <Icon name="corner-down-right" size={11} />
          </Link>
          <button
            type="button"
            className={`action ${styles.scoreToggle}`}
            aria-expanded={open}
            aria-controls={breakdownId}
            onClick={() => setOpen((v) => !v)}
            title="Discovery score: why this article was selected"
          >
            Score <span className={styles.scoreValue}>{Math.round(item.score.total)}</span>
          </button>
        </div>
        <div id={breakdownId} hidden={!open}>
          {open ? <ScoreBreakdown score={item.score} /> : null}
        </div>
      </div>
      {item.thumbnail ? (
        <Link href={articlePath(item.title)} className={styles.thumb} tabIndex={-1} aria-hidden="true">
          <ThumbImage thumbnail={item.thumbnail} size={88} />
        </Link>
      ) : null}
    </article>
  );
}

export function FeedItemSkeleton() {
  return (
    <div className={styles.item} aria-hidden="true">
      <div className={styles.rank}>&nbsp;</div>
      <div className={styles.body}>
        <div className="skeleton" style={{ width: 160, height: 10, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: "55%", height: 20, marginBottom: 10 }} />
        <div className="skeleton" style={{ width: "92%", height: 12, marginBottom: 7 }} />
        <div className="skeleton" style={{ width: "80%", height: 12, marginBottom: 14 }} />
        <div className="skeleton" style={{ width: 220, height: 10 }} />
      </div>
    </div>
  );
}
