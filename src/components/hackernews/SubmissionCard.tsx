import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { ExplorationPreview } from "@/lib/discovery/hole-types";
import { formatCount, formatRelative, leadSentences, pad2 } from "@/lib/format";
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
 * One submission in the Hacker News feed. The emphasis is on what can be
 * learned from it (its main Wikipedia article and concepts), with the
 * original submission and discussion kept one click away.
 */
export function SubmissionCard({ item, rank }: { item: ExplorationPreview; rank: number }) {
  const { submission, primary } = item;
  const kicker = [...item.disciplines.map((d) => d.label), CATEGORY_LABELS[submission.category]].join(" · ");
  return (
    <article className={styles.card} data-testid="hn-item" data-id={submission.id}>
      <div className={styles.rank} aria-hidden="true">
        {pad2(rank)}
      </div>
      <div className={styles.body}>
        <p className={`label ${styles.kicker}`}>{kicker}</p>
        <h2 className={styles.title}>
          <Link href={explorationPath(submission.id)} className={styles.titleLink}>
            {submission.title}
          </Link>
        </h2>
        {primary ? (
          <p className={styles.context}>
            About <em>{primary.title}</em>
            {primary.description ? `, ${primary.description.charAt(0).toLowerCase()}${primary.description.slice(1)}` : ""}.{" "}
            {leadSentences(primary.lead, 200)}
          </p>
        ) : null}
        {item.tags.length ? (
          <ul className={styles.tags} aria-label="Key concepts">
            {item.tags.map((tag) => (
              <li key={tag}>
                <Link className={styles.tag} href={articlePath(tag)}>
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <div className={styles.meta}>
          <span className={styles.strong}>{item.articleCount} Wikipedia articles</span>
          <span className="dot">{formatCount(submission.score)} points</span>
          <span className="dot">{formatCount(submission.comments)} comments</span>
          <span className="dot" suppressHydrationWarning>
            {formatRelative(submission.time)}
          </span>
          {submission.url && submission.domain ? (
            <a className="dot" href={submission.url} target="_blank" rel="noopener noreferrer" aria-label={`Original article on ${submission.domain} (opens in new tab)`}>
              {submission.domain} <Icon name="arrow-up-right" size={10} />
            </a>
          ) : null}
          <a className="dot" href={submission.hnUrl} target="_blank" rel="noopener noreferrer" aria-label="Discussion on Hacker News (opens in new tab)">
            Discussion <Icon name="arrow-up-right" size={10} />
          </a>
        </div>
        <div className={styles.actions}>
          <Link href={explorationPath(submission.id)} className="action">
            Open rabbit hole <Icon name="corner-down-right" size={11} />
          </Link>
          <span className="label" title="Rank: technical depth, novelty, topic relevance, entities, Wikipedia coverage, connections, engagement">
            Score {Math.round(item.score.total)} · Quality {Math.round(item.quality)}
          </span>
        </div>
      </div>
    </article>
  );
}

export function SubmissionCardSkeleton() {
  return (
    <div className={styles.card} aria-hidden="true">
      <div className={styles.rank}>&nbsp;</div>
      <div className={styles.body}>
        <div className="skeleton" style={{ width: 180, height: 10, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: "62%", height: 20, marginBottom: 10 }} />
        <div className="skeleton" style={{ width: "90%", height: 12, marginBottom: 7 }} />
        <div className="skeleton" style={{ width: "74%", height: 12, marginBottom: 14 }} />
        <div className="skeleton" style={{ width: 260, height: 10 }} />
      </div>
    </div>
  );
}
