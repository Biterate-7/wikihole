import Link from "next/link";
import { ContributorName, countLabel, SizeDelta, SummaryText } from "@/components/history/RevisionParts";
import history from "@/components/history/history.module.css";
import { formatDateTime, formatDelta } from "@/lib/format";
import { historyPath } from "@/lib/wikipedia/titles";
import type { ArticleHistory } from "@/lib/wikipedia/types";

const SHOWN = 8;

/**
 * The latest edits to the article, from Wikimedia's revision records: a compact
 * list in the manner of a Wikipedia history page, each edit opening its real diff.
 */
export function RecentChanges({ title, lang, data }: { title: string; lang: string; data: ArticleHistory }) {
  const recent = data.recent;
  const activity = data.activity;
  const facts = [
    data.edits ? `${countLabel(data.edits)} revisions in total` : null,
    data.contributors ? `${countLabel(data.contributors)} contributors` : null,
    activity && activity.edits > 0
      ? `${formatDelta(activity.bytesAdded)} / ${formatDelta(-activity.bytesRemoved)} bytes across ${activity.edits}${activity.complete ? "" : "+"} edits by ${activity.contributors} ${activity.contributors === 1 ? "contributor" : "contributors"} in the last ${activity.days} days`
      : null,
  ].filter(Boolean);

  return (
    <>
      {facts.length ? <p className={history.facts}>{facts.join(" · ")}</p> : null}
      {recent === null ? (
        <p className={history.facts}>Wikipedia did not return the list of recent edits.</p>
      ) : (
        <ol className={history.entries} data-testid="recent-changes">
          {recent.slice(0, SHOWN).map((revision) => (
            <li key={revision.id} className={history.entry}>
              <span className={`${history.time} ${history.plainTime}`}>
                <time dateTime={revision.timestamp}>{formatDateTime(revision.timestamp)}</time>
              </span>
              <ContributorName contributor={revision.contributor} />
              <span className={history.summary}>
                {revision.minor ? (
                  <abbr className={history.flag} title="Minor edit">
                    m
                  </abbr>
                ) : null}
                {revision.reverted ? <span className={history.flag}>reverted</span> : null}
                <SummaryText summary={revision.summary} hidden={revision.summaryHidden} />
              </span>
              <SizeDelta delta={revision.sizeDelta} />
              <Link className={history.diffLink} href={historyPath(title, lang, { to: revision.id })} prefetch={false} aria-label={`What changed in the edit of ${formatDateTime(revision.timestamp)}`}>
                diff
              </Link>
            </li>
          ))}
        </ol>
      )}
      <p className={history.more}>
        <Link href={historyPath(title, lang)} prefetch={false}>
          View full revision history
        </Link>
      </p>
    </>
  );
}

export function RecentChangesSkeleton() {
  return (
    <div aria-hidden="true" className={history.entries}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton" style={{ width: `${92 - i * 7}%`, height: 14, margin: "10px 0" }} />
      ))}
    </div>
  );
}
