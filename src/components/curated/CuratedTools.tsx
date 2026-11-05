import { Portlet } from "@/components/layout/Portlet";
import rail from "@/components/feed/rail.module.css";
import { DISCUSSION_CAP, HIDDEN_GEM_MAX_MONTHLY, RECENT_DAYS, SHARED_WEIGHT } from "@/lib/curated/rank";
import type { CatalogueMeta, HumanMeta, Rate } from "@/lib/curated/types";
import { formatCount, formatDate } from "@/lib/format";

/** Tools-column sections describing each dataset, written from its own published numbers. */

const percent = (value: number | null) => (value === null ? "unknown" : `${Math.round(value * 100)}%`);
const measured = (rate: Rate) => (rate.value === null ? "not yet measured" : `${percent(rate.value)} (${percent(rate.low)} to ${percent(rate.high)}, ${rate.n} checked)`);

export function RecommendedMethod({ meta }: { meta: HumanMeta | null }) {
  return (
    <div id="ranking" className={rail.ranking}>
      <Portlet id="tools-curated-ranking" heading="How recommendations count" headingTag="h2">
        <p className={rail.lede}>
          A link is not a recommendation. Each mention is classified, and only those where someone tells others the article is worth reading count. Doubtful ones wait for review.
        </p>
        <p className={rail.small}>
          A shared link readers upvoted counts {SHARED_WEIGHT} of someone saying so in words. Each person&rsquo;s later recommendations of the same article count for less, and one
          discussion counts for at most {DISCUSSION_CAP}, so no thread can dominate. Articles people mostly cite score lower than ones they mostly recommend, however often they
          come up.
        </p>
        <p className={rail.small}>
          Hidden gems have at least two recommenders and under {formatCount(HIDDEN_GEM_MAX_MONTHLY)} visits a month. Recently recommended covers {RECENT_DAYS} days.
        </p>
      </Portlet>
      {meta ? <EvidenceCoverage meta={meta} /> : null}
    </div>
  );
}

const STATUS: Record<string, string> = { complete: "complete", partial: "partial", "not-available": "not available" };

function EvidenceCoverage({ meta }: { meta: HumanMeta }) {
  const evaluation = meta.classification.evaluation;
  const models = Object.keys(meta.classification.deciders).filter((decider) => decider.startsWith("claude-"));
  return (
    <Portlet id="tools-curated-sources" heading="Where this comes from" headingTag="h2">
      <p className={rail.lede} data-testid="evidence-totals">
        {formatCount(meta.totals.qualifying)} qualifying recommendations of {formatCount(meta.totals.articles)} articles, from {formatCount(meta.totals.mentions)} mentions read.
      </p>
      <ul className={rail.sourceList}>
        {meta.sources.map((source) => (
          <li key={source.id} title={source.detail}>
            {source.name} ({STATUS[source.status]}){source.status === "not-available" ? "" : `: ${formatCount(source.qualifying)} of ${formatCount(source.mentions)} mentions count`}
          </li>
        ))}
      </ul>
      <p className={rail.small} data-testid="evaluation-summary">
        {models.length ? `Decided by rules and ${models.join(", ")}.` : "Decided by rules and review. No batch model has run."}{" "}
        {evaluation.labelled
          ? `On a held-out set of ${evaluation.labelled} labelled by ${evaluation.labeller}, rule precision on comments is ${measured(evaluation.comments.rulePrecision)}.`
          : ""}{" "}
        Updated {formatDate(meta.generatedAt)}.
      </p>
    </Portlet>
  );
}

export function ExploreMethod({ meta }: { meta: CatalogueMeta | null }) {
  return (
    <div id="ranking" className={rail.ranking}>
      <Portlet id="tools-explore" heading="What this covers" headingTag="h2">
        {meta ? (
          <>
            <p className={rail.lede} data-testid="catalogue-totals">
              {meta.scan.status === "complete" ? `Built from a complete scan of ${formatCount(meta.scan.articles)} articles in Wikipedia's ${meta.scan.pagesDumpDate ?? ""} database dump. ` : ""}
              {formatCount(meta.published)} are published here with deeper metadata: featured, good and unusual articles, a sample of substantial ones, and any page another dataset
              asked about.
            </p>
            <p className={rail.small}>
              Promise is measured only from Wikipedia: quality class, length, how many articles send readers here, and how little it is read. Reader numbers come from the{" "}
              {meta.scan.clickstreamMonth ?? ""} clickstream dump, with topics from Wikimedia&rsquo;s article classifier.
            </p>
          </>
        ) : (
          <p className={rail.lede}>The catalogue has not been built on this deployment.</p>
        )}
      </Portlet>
    </div>
  );
}
