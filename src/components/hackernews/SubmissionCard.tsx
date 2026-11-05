import Link from "next/link";
import type { ExplorationPreview } from "@/lib/discovery/hole-types";
import { formatCount, formatRelative, leadSentences } from "@/lib/format";
import { sourceLink } from "@/lib/hackernews/source-link";
import type { SubmissionCategory } from "@/lib/hackernews/types";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./hackernews.module.css";

export const CATEGORY_LABELS: Record<SubmissionCategory, string> = {
  story: "Story",
  ask: "Ask HN",
  show: "Show HN",
  launch: "Launch HN",
  tell: "Tell HN",
  job: "Job",
  poll: "Poll",
};

export function explorationPath(id: number): string {
  return `/hackernews/${id}`;
}

/**
 * One submission in the Hacker News feed, laid out like a search result.
 * The emphasis is on what can be learned from it (its main Wikipedia article
 * and concepts), with the original submission and discussion one click away.
 */
export function SubmissionCard({ item, rank }: { item: ExplorationPreview; rank: number }) {
  const { submission, primary } = item;
  const source = sourceLink(submission);
  const kicker = [CATEGORY_LABELS[submission.category], ...item.disciplines.map((d) => d.label)].join(" · ");
  return (
    <article className={styles.card} data-testid="hn-item" data-id={submission.id} data-rank={rank}>
      <div className={styles.body}>
        <h2 className={styles.title}>
          <Link href={explorationPath(submission.id)} className={styles.titleLink}>
            {submission.title}
          </Link>
        </h2>
        <p className={styles.kicker}>{kicker}</p>
        {primary ? (
          <p className={styles.context}>
            About <Link href={articlePath(primary.title)}>{primary.title}</Link>
            {primary.description ? `, ${primary.description.charAt(0).toLowerCase()}${primary.description.slice(1)}` : ""}.{" "}
            {leadSentences(primary.lead, 200)}
          </p>
        ) : null}
        {item.tags.length ? (
          <div className={styles.tagsRow}>
            <span className={styles.tagsLabel} aria-hidden="true">
              Concepts:
            </span>
            <ul className={styles.tags} aria-label="Key concepts">
              {item.tags.map((tag) => (
                <li key={tag}>
                  <Link href={articlePath(tag)}>{tag}</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className={styles.meta}>
          <span className={styles.strong}>{item.articleCount} Wikipedia articles</span>
          <span className="dot">{formatCount(submission.score)} points</span>
          <span className="dot">{formatCount(submission.comments)} comments</span>
          <span className="dot" suppressHydrationWarning>
            {formatRelative(submission.time)}
          </span>
          <span className="dot" title="Rank: technical depth, novelty, topic relevance, entities, Wikipedia coverage, connections, engagement">
            Score {Math.round(item.score.total)}, quality {Math.round(item.quality)}
          </span>
        </div>
        <div className={styles.actions}>
          <Link href={explorationPath(submission.id)} className="action">
            Open rabbit hole
          </Link>
          {source ? (
            <>
              <span className="dot" aria-hidden="true" />
              {source.external ? (
                <a className="action" href={source.href} target="_blank" rel="noopener noreferrer" aria-label={`Original article on ${source.label} (opens in new tab)`}>
                  {source.label}
                </a>
              ) : (
                <Link className="action" href={source.href}>
                  {source.label}
                </Link>
              )}
            </>
          ) : null}
          <span className="dot" aria-hidden="true" />
          <a className="action" href={submission.hnUrl} target="_blank" rel="noopener noreferrer" aria-label="Discussion on Hacker News (opens in new tab)">
            Discussion
          </a>
        </div>
      </div>
    </article>
  );
}

export function SubmissionCardSkeleton() {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className="skeleton" style={{ width: "62%", height: 18, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: 200, height: 11, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: "92%", height: 12, marginBottom: 6 }} />
      <div className="skeleton" style={{ width: "74%", height: 12, marginBottom: 8 }} />
      <div className="skeleton" style={{ width: 280, height: 11 }} />
    </div>
  );
}
