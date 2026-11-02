import { COMPONENT_LABELS } from "@/lib/discovery/config";
import { SCORE_COMPONENTS, type Discovery } from "@/lib/discovery/types";
import styles from "./feed.module.css";

/** Transparent view of why the discovery model ranked an article. */
export function ScoreBreakdown({ score }: { score: Discovery["score"] }) {
  return (
    <div className={styles.breakdown}>
      <dl className={styles.bars}>
        {SCORE_COMPONENTS.map((key) => {
          const value = score.components[key];
          return (
            <div key={key} className={styles.barRow}>
              <dt>{COMPONENT_LABELS[key]}</dt>
              <dd>
                <span className={styles.bar} aria-hidden="true">
                  <span style={{ width: `${Math.round(value * 100)}%` }} />
                </span>
                <span className={styles.barValue}>{value.toFixed(2)}</span>
              </dd>
            </div>
          );
        })}
      </dl>
      {score.signals.length ? (
        <ul className={styles.signals}>
          {score.signals.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
