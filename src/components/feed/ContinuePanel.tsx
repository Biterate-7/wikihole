"use client";

import Link from "next/link";
import { Portlet } from "@/components/layout/Portlet";
import layout from "@/components/layout/layout.module.css";
import { formatRelative } from "@/lib/format";
import { historyStore, trailsStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./rail.module.css";

/** "Continue exploring" in the tools column: the latest trail and recently read articles. */
export function ContinuePanel() {
  const hydrated = useHydrated();
  const history = useStore(historyStore);
  const trails = useStore(trailsStore);
  if (!hydrated || history.length === 0) return null;
  const trail = trails.find((t) => t.steps.length > 1);
  const last = trail?.steps[trail.steps.length - 1];

  return (
    <Portlet id="tools-continue" heading="Continue exploring" headingTag="h2">
      {trail && last ? (
        <p className={styles.trail}>
          <Link href={articlePath(last, undefined, trail.lang)}>Resume at depth {trail.steps.length}</Link>
          <span className={styles.trailSteps}>{trail.steps.slice(-3).join(" › ")}</span>
        </p>
      ) : null}
      <ul className={layout.portletList}>
        {history.slice(0, 5).map((h) => (
          <li key={`${h.lang ?? ""}:${h.title}`}>
            <Link href={articlePath(h.title, undefined, h.lang)} lang={h.lang} title={formatRelative(h.visitedAt)}>
              {h.title}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/saved?tab=history">Full history</Link>
        </li>
      </ul>
    </Portlet>
  );
}
