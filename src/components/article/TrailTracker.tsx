"use client";

import Link from "next/link";
import { useEffect } from "react";
import { currentTrailStore, notePendingNavigation, recordVisit } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./article.module.css";

/**
 * Records the visit in history and in the current Rabbit Hole trail, and
 * marks in-article link clicks so the next article extends the trail.
 * Renders the trail as breadcrumbs under the title, where Wikipedia shows
 * "(Redirected from …)" and subpage links.
 */
export function TrailTracker({ title, description, lang = DEFAULT_LANGUAGE }: { title: string; description?: string; lang?: string }) {
  const hydrated = useHydrated();
  const trail = useStore(currentTrailStore);

  useEffect(() => {
    recordVisit(title, description, lang);
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href^='/'][href*='/wiki/']");
      if (!anchor || anchor.closest("[data-trail-ignore]")) return;
      notePendingNavigation(title);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [title, description, lang]);

  const onTrail = hydrated && trail && (trail.lang ?? DEFAULT_LANGUAGE) === lang && trail.steps[trail.steps.length - 1] === title;
  const steps = onTrail ? trail.steps : [title];
  const shown = steps.length > 6 ? steps.slice(-6) : steps;
  const hidden = steps.length - shown.length;

  return (
    <nav className={styles.contentSub} aria-label="Rabbit hole trail" data-testid="trail">
      <span className={styles.trailLabel}>Rabbit hole{steps.length > 1 ? ` · depth ${steps.length}` : ""}:</span>
      <ol className={styles.trailList}>
        {hidden > 0 ? <li className={styles.trailMore}>+{hidden}</li> : null}
        {shown.map((step, i) => {
          const last = i === shown.length - 1;
          return (
            <li key={`${step}-${i}`}>
              {last ? (
                <span aria-current="page">{step}</span>
              ) : (
                <Link href={articlePath(step, undefined, lang)} prefetch={false}>
                  {step}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
