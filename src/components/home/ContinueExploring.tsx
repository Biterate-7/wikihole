"use client";

import Link from "next/link";
import { formatRelative } from "@/lib/format";
import { historyStore, trailsStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./home.module.css";

/** The Main Page's "Continue exploring" box: the reader's latest trail and reading history. */
export function ContinueExploring() {
  const hydrated = useHydrated();
  const history = useStore(historyStore);
  const trails = useStore(trailsStore);

  if (!hydrated || history.length === 0) {
    return (
      <p className={styles.continueEmpty}>
        Articles you read and the paths you follow between them appear here. Start with today&rsquo;s featured
        discovery, a <Link href="/random">random article</Link>, or the <Link href="/discover">Discover feed</Link>.
      </p>
    );
  }

  const trail = trails.find((t) => t.steps.length > 1);
  const last = trail?.steps[trail.steps.length - 1];
  return (
    <>
      {trail && last ? (
        <p className={styles.trail}>
          <b>Your latest rabbit hole</b> (depth {trail.steps.length}):{" "}
          {trail.steps.slice(-4).map((step, i) => (
            <span key={`${step}-${i}`}>
              {i ? " → " : ""}
              <Link href={articlePath(step, undefined, trail.lang)} lang={trail.lang}>
                {step}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      <ul className={styles.recent}>
        {history.slice(0, 5).map((h) => (
          <li key={`${h.lang ?? ""}:${h.title}`}>
            <Link href={articlePath(h.title, undefined, h.lang)} lang={h.lang}>
              {h.title}
            </Link>{" "}
            <span className={styles.sourced}>({formatRelative(h.visitedAt)})</span>
          </li>
        ))}
      </ul>
      <p className={styles.boxFooter}>
        <Link href="/saved?tab=trails">All trails</Link> · <b>
          <Link href="/saved?tab=history">Reading history</Link>
        </b>
      </p>
    </>
  );
}
