"use client";

import Link from "next/link";
import { formatRelative } from "@/lib/format";
import { historyStore, trailsStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./rail.module.css";

/** "Continue exploring": the most recent trail and recently read articles. */
export function ContinuePanel() {
  const hydrated = useHydrated();
  const history = useStore(historyStore);
  const trails = useStore(trailsStore);
  if (!hydrated || history.length === 0) return null;
  const trail = trails.find((t) => t.steps.length > 1);
  const last = trail?.steps[trail.steps.length - 1];

  return (
    <section className={styles.panel} aria-labelledby="continue-heading">
      <h2 id="continue-heading" className="label">
        Continue exploring
      </h2>
      {trail && last ? (
        <div className={styles.trail}>
          <ol className={styles.trailSteps}>
            {trail.steps.slice(-4).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Link href={articlePath(last)} className="btn">
            Resume at depth {trail.steps.length}
          </Link>
        </div>
      ) : null}
      <ul className={styles.recent}>
        {history.slice(0, 5).map((h) => (
          <li key={h.title}>
            <Link href={articlePath(h.title)}>{h.title}</Link>
            <span className="label">{formatRelative(h.visitedAt)}</span>
          </li>
        ))}
      </ul>
      <Link href="/saved?tab=history" className="action">
        Full history
      </Link>
    </section>
  );
}
