import Link from "next/link";
import { countLabel } from "@/components/history/RevisionParts";
import { formatDate } from "@/lib/format";
import { historyPath } from "@/lib/wikipedia/titles";
import type { ArticleHistory, RecentActivity } from "@/lib/wikipedia/types";
import styles from "./article.module.css";

function activityLabel(activity: RecentActivity): string {
  if (activity.edits === 0) return `No edits in the last ${activity.days} days`;
  const count = `${activity.edits}${activity.complete ? "" : "+"}`;
  return `${count} edit${activity.edits === 1 && activity.complete ? "" : "s"} in the last ${activity.days} days`;
}

/**
 * The article's history facts, in the tools column with the rest of its page
 * information, so the article itself starts where it always has. Each item
 * comes straight from Wikimedia, and an item it did not return is simply absent.
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
  const editedAt = latest?.timestamp ?? lastEdited;
  const edited = formatDate(editedAt);
  const created = formatDate(history?.created?.timestamp);
  const edits = history?.edits;
  const contributors = history?.contributors;
  const activity = history?.activity;
  if (!edited && !created && !edits && !contributors && !activity) return null;

  return (
    <dl className={styles.pageInfo} data-testid="article-metadata">
      {created ? (
        <div>
          <dt>Created</dt>
          <dd>
            <time dateTime={history?.created?.timestamp}>{created}</time>
          </dd>
        </div>
      ) : null}
      {edits || contributors || activity ? (
        <div>
          <dt>History</dt>
          {edits ? (
            <dd>
              <Link href={historyPath(title, lang)} prefetch={false}>
                {countLabel(edits)} {edits.count === 1 && !edits.capped ? "edit" : "edits"}
              </Link>
            </dd>
          ) : null}
          {contributors ? (
            <dd>
              {countLabel(contributors)} {contributors.count === 1 && !contributors.capped ? "contributor" : "contributors"}
            </dd>
          ) : null}
          {activity ? <dd>{activityLabel(activity)}</dd> : null}
        </div>
      ) : null}
      {edited ? (
        <div>
          <dt>Last edited</dt>
          <dd>
            {latest ? (
              <Link href={historyPath(title, lang, { to: latest.id })} prefetch={false}>
                <time dateTime={latest.timestamp}>{edited}</time>
              </Link>
            ) : (
              <time dateTime={editedAt}>{edited}</time>
            )}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
