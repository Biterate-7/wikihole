import Link from "next/link";
import { countLabel } from "@/components/history/RevisionParts";
import { formatDate, formatDateTime } from "@/lib/format";
import { historyPath } from "@/lib/wikipedia/titles";
import type { ArticleHistory, RecentActivity } from "@/lib/wikipedia/types";
import styles from "./article.module.css";

function activityLabel(activity: RecentActivity): string {
  if (activity.edits === 0) return `No edits in the last ${activity.days} days`;
  const count = `${activity.edits}${activity.complete ? "" : "+"}`;
  return `${count} edit${activity.edits === 1 && activity.complete ? "" : "s"} in the last ${activity.days} days`;
}

/** The description, on its own line so the counts below stay a single quiet row. */
export function ArticleDescription({ description }: { description?: string }) {
  return description ? <p className={styles.description}>{description}</p> : null;
}

/**
 * The line of facts under the title. Each item comes straight from Wikimedia,
 * and an item it did not return is simply absent.
 */
export function ArticleMetadata({
  title,
  lang,
  history,
  lastEdited,
}: {
  title: string;
  lang: string;
  history: ArticleHistory | null;
  /** From the page metadata, used if the revision list is unavailable. */
  lastEdited?: string;
}) {
  const latest = history?.recent?.[0];
  const edited = formatDateTime(latest?.timestamp ?? lastEdited);
  const created = formatDate(history?.created?.timestamp);
  const edits = history?.edits;
  const contributors = history?.contributors;
  const activity = history?.activity;
  if (!edited && !created && !edits && !contributors && !activity) return null;

  return (
    <ul className={styles.metaLine} data-testid="article-metadata">
      {created ? (
        <li>
          Created <time dateTime={history?.created?.timestamp}>{created}</time>
        </li>
      ) : null}
      {edits ? (
        <li>
          <Link href={historyPath(title, lang)} prefetch={false}>
            {countLabel(edits)} {edits.count === 1 && !edits.capped ? "edit" : "edits"}
          </Link>
        </li>
      ) : null}
      {contributors ? (
        <li>
          {countLabel(contributors)} {contributors.count === 1 && !contributors.capped ? "contributor" : "contributors"}
        </li>
      ) : null}
      {edited ? (
        <li>
          Last edited{" "}
          {latest ? (
            <Link href={historyPath(title, lang, { to: latest.id })} prefetch={false}>
              <time dateTime={latest.timestamp}>{edited}</time>
            </Link>
          ) : (
            <time dateTime={lastEdited}>{edited}</time>
          )}
        </li>
      ) : null}
      {activity ? <li>{activityLabel(activity)}</li> : null}
    </ul>
  );
}
