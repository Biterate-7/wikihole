import { COMPONENT_DESCRIPTIONS, COMPONENT_LABELS, MODEL, weightsFor } from "@/lib/discovery/config";
import { SCORE_COMPONENTS } from "@/lib/discovery/types";
import { PAGEVIEW_DAYS } from "@/lib/wikipedia/types";
import styles from "./rail.module.css";

/** Server-rendered description of the live ranking configuration. */
export function RankingExplainer() {
  const weights = weightsFor("balanced");
  return (
    <section id="ranking" className={styles.panel} aria-labelledby="ranking-heading">
      <h2 id="ranking-heading" className="label">
        How this feed is ranked
      </h2>
      <p className={styles.lede}>
        Candidates are drawn at random from curated Wikipedia categories, then scored with this model. Nothing is
        hand-picked and no metric is invented: every input is Wikipedia metadata.
      </p>
      <dl className={styles.weights}>
        {SCORE_COMPONENTS.map((key) => (
          <div key={key} className={styles.weightRow}>
            <dt>
              <span>{COMPONENT_LABELS[key]}</span>
              <span className={styles.weightValue}>{Math.round(weights[key] * 100)}%</span>
            </dt>
            <dd>{COMPONENT_DESCRIPTIONS[key]}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.small}>
        Rejected outright: disambiguation pages, lists, stubs under {MODEL.minLengthBytes / 1000}k bytes, biographies,
        entertainment, sports, places and organisations. Pageviews cover the last {PAGEVIEW_DAYS} days.
      </p>
    </section>
  );
}
