import { Portlet } from "@/components/layout/Portlet";
import rail from "@/components/feed/rail.module.css";
import { DISCUSSION_CAP, HIDDEN_GEM_MAX_MONTHLY, RECENT_DAYS } from "@/lib/curated/rank";
import type { SnapshotMeta } from "@/lib/curated/types";
import { formatCount, formatDate } from "@/lib/format";

/** Tools-column sections describing the evidence, written from the snapshot's own numbers. */

export function RecommendedMethod({ meta }: { meta: SnapshotMeta | null }) {
  return (
    <div id="ranking" className={rail.ranking}>
      <Portlet id="tools-curated-ranking" heading="How recommendations count" headingTag="h2">
        <p className={rail.lede}>
          A link is not a recommendation. Each mention is classified, and only those where someone tells others the article is worth reading count.
        </p>
        <p className={rail.small}>
          Each person&rsquo;s later recommendations of the same article count for less, and one discussion counts for at most {DISCUSSION_CAP}, so no thread can
          dominate. Rankings then favour many months, many years and more than one community.
        </p>
        <p className={rail.small}>
          Hidden gems have at least two recommenders and under {formatCount(HIDDEN_GEM_MAX_MONTHLY)} visits a month. Recently recommended covers {RECENT_DAYS} days.
        </p>
      </Portlet>
      {meta ? <EvidenceCoverage meta={meta} /> : null}
    </div>
  );
}

function EvidenceCoverage({ meta }: { meta: SnapshotMeta }) {
  const reviewed = meta.classification.reviewed;
  const models = Object.keys(meta.classification.deciders).filter((decider) => decider.startsWith("claude-"));
  return (
    <Portlet id="tools-curated-sources" heading="Where this comes from" headingTag="h2">
      <p className={rail.lede} data-testid="evidence-totals">
        {formatCount(meta.human.qualifying)} qualifying recommendations of {formatCount(meta.human.articles)} articles, from {formatCount(meta.human.discussions)} discussions.
      </p>
      <ul className={rail.sourceList}>
        {meta.sources.map((source) => (
          <li key={source.id} title={source.detail}>
            {source.name}:{" "}
            {source.status === "not-available"
              ? "not available"
              : `${formatCount(source.qualifying)} of ${formatCount(source.mentions)} mentions qualified${source.status === "partial" ? " (partial)" : ""}`}
          </li>
        ))}
      </ul>
      <p className={rail.small}>
        {models.length
          ? `Classified by rules, then by ${models.join(", ")}.`
          : "Classified by rules, not yet by a language model."}
        {reviewed.comments.checked
          ? ` In a reviewed random sample, ${reviewed.comments.confirmed} of ${reviewed.comments.checked} counted comments and ${reviewed.submissions.confirmed} of ${reviewed.submissions.checked} counted submissions were confirmed.`
          : ""}{" "}
        Updated {formatDate(meta.generatedAt)}.
      </p>
    </Portlet>
  );
}

export function ExploreMethod({ meta }: { meta: SnapshotMeta | null }) {
  return (
    <div id="ranking" className={rail.ranking}>
      <Portlet id="tools-explore" heading="What this covers" headingTag="h2">
        {meta ? (
          <>
            <p className={rail.lede} data-testid="catalogue-totals">
              {meta.catalogue.articlesScanned > 0 ? `Built from a scan of ${formatCount(meta.catalogue.articlesScanned)} articles in Wikipedia's ${meta.catalogue.pagesDumpDate ?? ""} database dump. ` : ""}
              {formatCount(meta.catalogue.published)} articles are published here with deeper metadata: everything people recommended, Wikipedia&rsquo;s featured, good and
              unusual articles, and a sample of substantial articles.
            </p>
            <p className={rail.small}>
              Promise is measured from quality class, length, how many articles send readers here, and how little it is read. Reader numbers come from the{" "}
              {meta.catalogue.clickstreamMonth ?? ""} clickstream dump, with topics from Wikimedia&rsquo;s article classifier.
            </p>
          </>
        ) : (
          <p className={rail.lede}>The catalogue has not been built on this deployment.</p>
        )}
      </Portlet>
    </div>
  );
}
