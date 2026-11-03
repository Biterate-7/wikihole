import rail from "@/components/feed/rail.module.css";
import { HN_COMPONENTS } from "@/lib/discovery/hole-types";
import { QUALITY_MODEL } from "@/lib/discovery/quality-scoring";
import { HN_COMPONENT_DESCRIPTIONS, HN_COMPONENT_LABELS, hnWeights } from "@/lib/hackernews/ranking";
import styles from "./hackernews.module.css";

/** Server-rendered description of the Hacker News pipeline and its live ranking weights. */
export function HnRankingExplainer() {
  const weights = hnWeights();
  return (
    <>
      <section className={rail.panel} aria-labelledby="hn-pipeline-heading">
        <h2 id="hn-pipeline-heading" className="label">
          From a submission to a rabbit hole
        </h2>
        <ol className={styles.pipeline}>
          <li>Read the Top, Best, Show HN, Ask HN and New lists from the official Hacker News API.</li>
          <li>Filter out jobs, career advice, promotion and general news; pre-rank the rest.</li>
          <li>Extract names, technologies and concepts from the title, the post and the first comments.</li>
          <li>Match each one to a Wikipedia article, validating the title, alternative names, context and quality.</li>
          <li>Follow where those articles link: their definitions, infoboxes, History and Legacy sections, See also.</li>
          <li>Connect everything with the real links between the articles, and score the result.</li>
        </ol>
        <p className={rail.small}>
          A submission is shown only when its rabbit hole is anchored by a confidently matched article and reaches at least{" "}
          {QUALITY_MODEL.minArticles} articles with a quality score of {QUALITY_MODEL.minScore} or more.
        </p>
      </section>
      <section id="hn-ranking" className={rail.panel} aria-labelledby="hn-ranking-heading">
        <h2 id="hn-ranking-heading" className="label">
          How submissions are ranked
        </h2>
        <p className={rail.lede}>Popularity is a minor, capped signal. A niche technical post can outrank a front-page hit.</p>
        <dl className={rail.weights}>
          {HN_COMPONENTS.map((key) => (
            <div key={key} className={rail.weightRow}>
              <dt>
                <span>{HN_COMPONENT_LABELS[key]}</span>
                <span className={rail.weightValue}>{Math.round(weights[key] * 100)}%</span>
              </dt>
              <dd>{HN_COMPONENT_DESCRIPTIONS[key]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
