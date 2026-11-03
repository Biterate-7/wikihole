import Link from "next/link";
import { Portlet } from "@/components/layout/Portlet";
import { QUALITY_COMPONENTS, type Exploration } from "@/lib/discovery/hole-types";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./exploration.module.css";

const QUALITY_LABELS: Record<(typeof QUALITY_COMPONENTS)[number], string> = {
  coverage: "Coverage",
  confidence: "Match confidence",
  depth: "Depth",
  connectivity: "Interlinking",
  articles: "Article quality",
  technical: "Technical",
};

const REASON_LABELS: Record<string, string> = {
  "no-article": "no matching article",
  "low-confidence": "no confident match",
  "disambiguation-only": "ambiguous name",
  "rejected-page": "not an article",
};

/**
 * Tools-column sections for a rabbit hole: what was extracted from the
 * submission and how it matched, the quality score, and sources.
 */
export function ExplorationTools({ exploration }: { exploration: Exploration }) {
  const { entities, quality, submission } = exploration;
  return (
    <>
      <Portlet id="tools-extracted" heading="What was extracted" headingTag="h2">
        <ul className={styles.entities} data-testid="hole-entities">
          {entities.map((e) => (
            <li key={`${e.entity}-${e.title ?? e.reason}`}>
              <span className={styles.entityPhrase}>{e.entity}</span>{" "}
              {e.status === "resolved" && e.title ? (
                <>
                  → <Link href={articlePath(e.title)}>{e.title}</Link>
                </>
              ) : (
                <span className={styles.muted}>({REASON_LABELS[e.reason ?? ""] ?? "not matched"})</span>
              )}
              <span className={styles.entityMeta}>
                From the {e.source === "text" ? "post" : e.source === "comments" ? "discussion" : e.source}
                {e.confidence ? `, ${Math.round(e.confidence * 100)}% ${e.method}` : ""}
                {e.closest ? `, closest: ${e.closest.title}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Portlet>
      <Portlet id="tools-quality" heading={`Rabbit hole quality: ${Math.round(quality.score)}`} headingTag="h2">
        <dl className={styles.bars}>
          {QUALITY_COMPONENTS.map((key) => (
            <div key={key} className={styles.barRow}>
              <dt>{QUALITY_LABELS[key]}</dt>
              <dd>
                <span className={styles.bar} aria-hidden="true">
                  <span style={{ width: `${Math.round(quality.components[key] * 100)}%` }} />
                </span>
                <span className={styles.barValue}>{quality.components[key].toFixed(2)}</span>
              </dd>
            </div>
          ))}
        </dl>
      </Portlet>
      <Portlet
        id="tools-sources"
        heading="Sources"
        items={[
          { href: submission.hnUrl, label: "Submission on Hacker News", external: true },
          ...(submission.url ? [{ href: submission.url, label: submission.domain ?? "Original article", external: true }] : []),
          { href: "https://github.com/HackerNews/API", label: "Hacker News API", external: true },
          { href: "https://creativecommons.org/licenses/by-sa/4.0/", label: "Wikipedia text: CC BY-SA 4.0", external: true },
        ]}
      />
    </>
  );
}
