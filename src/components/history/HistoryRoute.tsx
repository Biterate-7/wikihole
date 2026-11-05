import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { articleTabs } from "@/components/article/ArticleParts";
import { RecentChangesSkeleton } from "@/components/article/RecentChanges";
import { DiffSkeleton, DiffView } from "@/components/history/DiffView";
import { PageShell, SiteSub } from "@/components/layout/PageShell";
import { StateMessage } from "@/components/ui/StateMessage";
import { isAiEnabled } from "@/lib/ai/config";
import { loadHistory, loadMeta } from "@/lib/article";
import { formatDate, formatDateTime } from "@/lib/format";
import { getLanguage, languageLocale } from "@/lib/i18n/languages";
import { attempt, describeError } from "@/lib/server/http";
import { compareRevisions, ComparisonError, getRevisionPage } from "@/lib/wikipedia/revisions";
import { WikipediaError } from "@/lib/wikipedia/http";
import { articlePath, historyPath, titleFromSlug } from "@/lib/wikipedia/titles";
import { ContributorName, countLabel, SizeDelta, SummaryText } from "./RevisionParts";
import styles from "./history.module.css";

/** An article's revision history and comparisons, shared by /history/<Title> and /<lang>/history/<Title>. */

export type HistorySearch = Record<string, string | string[] | undefined>;

function revisionParam(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) return undefined;
  const id = Number(value);
  return id > 0 ? id : undefined;
}

export async function historyMetadata(slug: string[], lang: string, search: HistorySearch): Promise<Metadata> {
  const title = titleFromSlug(slug) ?? "Article";
  const comparing = revisionParam(search.to) !== undefined;
  return {
    title: comparing ? `Changes to ${title}` : `Revision history of ${title}`,
    alternates: { canonical: historyPath(title, lang) },
    // Comparisons are endless and add nothing to search results.
    robots: comparing || search.older ? { index: false } : undefined,
  };
}

/** Compare API errors for revisions a reader asked for by id, in plain words. */
function comparisonProblem(error: unknown): string {
  if (error instanceof ComparisonError) return error.message;
  if (error instanceof WikipediaError && error.kind === "api") {
    if (error.code === "nosuchrevid") return "One of those revisions does not exist on Wikipedia.";
    return "Wikipedia cannot show this comparison. A revision's content may have been hidden.";
  }
  return describeError(error).message;
}

async function Comparison({ title, lang, from, to }: { title: string; lang: string; from?: number; to: number }) {
  // Revision ids only grow, so a reversed pair still reads older to newer.
  const [older, newer] = from !== undefined && from > to ? [to, from] : [from, to];
  const result = await attempt(() => compareRevisions(title, newer, older, lang));
  if (result.ok) return <DiffView comparison={result.value} lang={lang} aiEnabled={isAiEnabled()} />;
  return (
    <StateMessage
      kind="error"
      title="This comparison could not be loaded."
      action={
        <a className="btn" href={historyPath(title, lang, { from: older, to: newer })}>
          Try again
        </a>
      }
    >
      {comparisonProblem(result.error)}
    </StateMessage>
  );
}

async function Facts({ title, lang }: { title: string; lang: string }) {
  const history = await loadHistory(title, lang);
  const created = formatDate(history.created?.timestamp);
  const facts = [
    history.edits ? `${countLabel(history.edits)} revisions` : null,
    history.contributors ? `${countLabel(history.contributors)} contributors` : null,
    created ? `created ${created}` : null,
  ].filter(Boolean);
  return facts.length ? <p className={styles.facts}>{facts.join(" · ")}</p> : null;
}

async function RevisionList({ title, lang, older, selectedTo, selectedFrom }: { title: string; lang: string; older?: number; selectedFrom?: number; selectedTo?: number }) {
  const result = await attempt(() => getRevisionPage(title, lang, { from: older }));
  if (!result.ok) {
    return (
      <StateMessage kind="error" title="The revision list could not be loaded.">
        {describeError(result.error).message}
      </StateMessage>
    );
  }
  const { revisions, olderFrom } = result.value;
  if (revisions.length === 0) return <p className={styles.facts}>There are no revisions to show.</p>;
  const defaultTo = selectedTo ?? revisions[0].id;
  const defaultFrom = selectedFrom ?? revisions[1]?.id;

  return (
    <form method="get" action={historyPath(title, lang)} data-testid="revision-list">
      <div className={styles.listBar}>
        <button type="submit" className="btn">
          Compare selected revisions
        </button>
        <span className={styles.muted}>Choose an older revision on the left and a newer one on the right.</span>
      </div>
      <ol className={styles.entries}>
        {revisions.map((revision) => (
          <li key={revision.id} className={styles.historyEntry}>
            <span className={styles.radios}>
              <input type="radio" name="from" value={revision.id} defaultChecked={revision.id === defaultFrom} aria-label={`Compare from the revision of ${formatDateTime(revision.timestamp)}`} />
              <input type="radio" name="to" value={revision.id} defaultChecked={revision.id === defaultTo} aria-label={`Compare to the revision of ${formatDateTime(revision.timestamp)}`} />
            </span>
            <time className={`${styles.time} ${styles.plainTime}`} dateTime={revision.timestamp}>
              {formatDateTime(revision.timestamp)}
            </time>
            <ContributorName contributor={revision.contributor} />
            <span className={styles.summary}>
              {revision.minor ? (
                <abbr className={styles.flag} title="Minor edit">
                  m
                </abbr>
              ) : null}
              {revision.reverted ? <span className={styles.flag}>reverted</span> : null}
              <SummaryText summary={revision.summary} hidden={revision.summaryHidden} />
            </span>
            <SizeDelta delta={revision.sizeDelta} />
            <Link className={styles.diffLink} href={historyPath(title, lang, { to: revision.id })} prefetch={false} aria-label={`What changed in the edit of ${formatDateTime(revision.timestamp)}`}>
              diff
            </Link>
          </li>
        ))}
      </ol>
      <nav className={styles.pager} aria-label="Older and newer revisions">
        {older !== undefined ? (
          <Link href={historyPath(title, lang)} prefetch={false}>
            Latest edits
          </Link>
        ) : null}
        {olderFrom !== undefined ? (
          <Link href={historyPath(title, lang, { older: olderFrom })} prefetch={false} data-testid="older-revisions">
            Older edits →
          </Link>
        ) : (
          <span className={styles.muted}>This is the first revision of the article.</span>
        )}
      </nav>
    </form>
  );
}

export async function HistoryView({ slug, lang, search }: { slug: string[]; lang: string; search: HistorySearch }) {
  const title = titleFromSlug(slug);
  if (!title) notFound();
  const to = revisionParam(search.to);
  const from = revisionParam(search.from);
  const older = revisionParam(search.older);
  const locale = languageLocale(getLanguage(lang));

  const meta = await attempt(() => loadMeta(title, lang));
  if (meta.ok) {
    if (meta.value === null) notFound();
    if (meta.value.title !== title) permanentRedirect(historyPath(meta.value.title, lang, { from, to, older }));
  } else if (meta.error instanceof WikipediaError && meta.error.kind === "notfound") {
    notFound();
  }

  return (
    <div data-testid="history-page">
      <PageShell
        title={
          <>
            Revision history of{" "}
            <span lang={locale}>
              <Link href={articlePath(title, undefined, lang)} prefetch={false}>
                {title}
              </Link>
            </span>
          </>
        }
        tabs={articleTabs(title, lang, "history")}
      >
        <SiteSub>From Wikipedia&rsquo;s revision records</SiteSub>
        <Suspense fallback={<div className={styles.factsPlaceholder} />}>
          <Facts title={title} lang={lang} />
        </Suspense>
        {to !== undefined ? (
          <Suspense key={`${from}-${to}`} fallback={<DiffSkeleton />}>
            <Comparison title={title} lang={lang} from={from} to={to} />
          </Suspense>
        ) : null}
        <section aria-labelledby="revisions-heading">
          <h2 id="revisions-heading" className={styles.compareHeading}>
            {older !== undefined ? "Older revisions" : "Latest revisions"}
          </h2>
          <Suspense key={older ?? "latest"} fallback={<RecentChangesSkeleton />}>
            <RevisionList title={title} lang={lang} older={older} selectedFrom={from} selectedTo={to} />
          </Suspense>
        </section>
      </PageShell>
    </div>
  );
}
