import { formatDelta } from "@/lib/format";
import type { Contributor, EditSummary, HistoryCount } from "@/lib/wikipedia/types";
import styles from "./history.module.css";

/** Small pieces shared by the article's Recent changes and the history page. */

export function countLabel(count: HistoryCount): string {
  return `${count.count.toLocaleString("en-US")}${count.capped ? "+" : ""}`;
}

/** A contributor's name, credited as plain text: readers stay in WikiHole. */
export function ContributorName({ contributor }: { contributor: Contributor }) {
  switch (contributor.kind) {
    case "registered":
      return (
        <span className={styles.contributor} dir="auto">
          {contributor.name}
        </span>
      );
    case "temporary":
      return <span className={styles.contributor}>Temporary account</span>;
    case "anonymous":
      return <span className={styles.contributor}>Anonymous contributor</span>;
    case "hidden":
      return <span className={`${styles.contributor} ${styles.muted}`}>Username hidden</span>;
  }
}

export function SummaryText({ summary, hidden }: { summary: EditSummary | null; hidden: boolean }) {
  if (hidden) return <span className={styles.muted}>Edit summary hidden</span>;
  if (!summary) return <span className={styles.muted}>No edit summary</span>;
  return (
    <>
      {summary.section ? (
        <span className={styles.section} dir="auto">
          § {summary.section}
        </span>
      ) : null}
      {summary.section && summary.text ? " " : null}
      {summary.text ? <span dir="auto">{summary.text}</span> : null}
    </>
  );
}

export function SizeDelta({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const tone = delta > 0 ? styles.sizeUp : delta < 0 ? styles.sizeDown : styles.muted;
  return (
    <span className={`${styles.size} ${tone}`} title={`${delta.toLocaleString("en-US")} bytes after this edit`}>
      {formatDelta(delta)}
    </span>
  );
}
