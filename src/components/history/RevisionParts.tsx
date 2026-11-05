import { formatDelta } from "@/lib/format";
import { wikipediaDomain } from "@/lib/i18n/languages";
import type { Contributor, EditSummary, HistoryCount } from "@/lib/wikipedia/types";
import styles from "./history.module.css";

/** Small pieces shared by the article's Recent changes and the history page. */

export function revisionUrl(lang: string, id: number): string {
  return `https://${wikipediaDomain(lang)}/w/index.php?oldid=${id}`;
}

export function compareUrl(lang: string, from: number, to: number): string {
  return `https://${wikipediaDomain(lang)}/w/index.php?oldid=${from}&diff=${to}`;
}

export function countLabel(count: HistoryCount): string {
  return `${count.count.toLocaleString("en-US")}${count.capped ? "+" : ""}`;
}

/**
 * A contributor's name. It links to their Wikipedia user page as attribution on
 * the history page; the article itself passes `linked={false}` and keeps readers here.
 */
export function ContributorName({ contributor, lang, linked = true }: { contributor: Contributor; lang: string; linked?: boolean }) {
  switch (contributor.kind) {
    case "registered":
      if (!linked) {
        return (
          <span className={styles.contributor} dir="auto">
            {contributor.name}
          </span>
        );
      }
      return (
        <a
          className={styles.contributor}
          href={`https://${wikipediaDomain(lang)}/wiki/${encodeURIComponent(`User:${contributor.name}`.replace(/ /g, "_"))}`}
          target="_blank"
          rel="noopener noreferrer"
          dir="auto"
        >
          {contributor.name}
        </a>
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
