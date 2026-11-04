"use client";

import Link from "next/link";
import { useState } from "react";
import { SaveButton } from "@/components/ui/SaveButton";
import { ThumbImage } from "@/components/ui/ThumbImage";
import type { Discovery } from "@/lib/discovery/types";
import { ASSESSMENT_LABELS, assessmentBadge, formatCount, leadSentences } from "@/lib/format";
import { articlePath } from "@/lib/wikipedia/titles";
import { PAGEVIEW_DAYS } from "@/lib/wikipedia/types";
import { ScoreBreakdown } from "./ScoreBreakdown";
import styles from "./feed.module.css";

/** One discovery, laid out as a Wikipedia search result: thumbnail, title, description, intro, data line. */
export function FeedItem({ item, rank, visited, showRelation }: { item: Discovery; rank: number; visited?: boolean; showRelation?: boolean }) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const badge = assessmentBadge(item.assessment);
  const kicker = [item.groupLabel, item.subtopicLabel].filter(Boolean).join(" › ");
  const breakdownId = `why-${item.pageId}`;
  const href = articlePath(item.title);

  return (
    <article className={styles.item} data-testid="feed-item" data-title={item.title} data-rank={rank}>
      {/* No thumbnail (or one that failed to load) means no thumbnail slot at all: the body takes the full row. */}
      {item.thumbnail && !imageFailed ? (
        <Link href={href} className={styles.thumb} tabIndex={-1} aria-hidden="true">
          <ThumbImage thumbnail={item.thumbnail} size={80} onFail={() => setImageFailed(true)} />
        </Link>
      ) : null}
      <div className={styles.body}>
        <h2 className={styles.title}>
          <Link href={href} className={styles.titleLink}>
            {item.title}
          </Link>
          {visited ? <span className={styles.visited}>(read)</span> : null}
        </h2>
        {showRelation && item.relation ? (
          <p className={`label ${styles.kicker}`} title={item.relation.evidence}>
            {item.relation.label}
          </p>
        ) : kicker ? (
          <p className={`label ${styles.kicker}`}>{kicker}</p>
        ) : null}
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
            <span className="dot" title={ASSESSMENT_LABELS[item.assessment ?? "Other"]}>
              {badge}-class
            </span>
          ) : null}
          {item.recentViews !== null ? (
            <span className="dot" title={`Pageviews over the last ${PAGEVIEW_DAYS} days`}>
              {formatCount(item.recentViews)} views in {PAGEVIEW_DAYS} days
            </span>
          ) : null}
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
          <span className="dot" aria-hidden="true" />
          <Link href={`${href}#rabbit-hole`} className="action">
            Rabbit hole
          </Link>
          <span className="dot" aria-hidden="true" />
          <a className="action" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} on Wikipedia (opens in new tab)`}>
            Wikipedia
          </a>
          <span className="dot" aria-hidden="true" />
          <button
            type="button"
            className={`action ${styles.scoreToggle}`}
            aria-expanded={open}
            aria-controls={breakdownId}
            onClick={() => setOpen((v) => !v)}
            title="Discovery score: why this article was selected"
          >
            Score {Math.round(item.score.total)}
          </button>
        </div>
        <div id={breakdownId} hidden={!open}>
          {open ? <ScoreBreakdown score={item.score} /> : null}
        </div>
      </div>
    </article>
  );
}

export function FeedItemSkeleton() {
  return (
    <div className={styles.item} aria-hidden="true">
      <div className={styles.thumb}>
        <span className={`skeleton ${styles.thumbSkeleton}`} />
      </div>
      <div className={styles.body}>
        <div className="skeleton" style={{ width: "45%", height: 18, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 160, height: 12, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: "92%", height: 12, marginBottom: 6 }} />
        <div className="skeleton" style={{ width: "80%", height: 12, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 220, height: 10 }} />
      </div>
    </div>
  );
}
