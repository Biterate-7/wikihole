"use client";

import { useState } from "react";
import { titleKey } from "@/lib/trails/key";
import type { ResolvedTrail } from "@/lib/trails/types";
import { TrailView } from "./TrailView";
import styles from "./trails.module.css";

const startOf = (t: ResolvedTrail) => t.stops[0].title;
const endOf = (t: ResolvedTrail) => t.stops[t.stops.length - 1].title;

/**
 * Shows one trail at a time from a pool. Trails that share the active trail's
 * start are offered as alternatives; "Explore another trail" moves to the next
 * trail with a different start. Controls appear only when there is somewhere
 * for them to go.
 */
export function TrailExplorer({
  trails,
  initialId,
  loading = false,
  headingLevel = 2,
}: {
  trails: ResolvedTrail[];
  initialId?: string;
  loading?: boolean;
  headingLevel?: 2 | 3;
}) {
  const [activeId, setActiveId] = useState(initialId ?? trails[0]?.id);
  const active = trails.find((t) => t.id === activeId) ?? trails[0];
  if (!active) return null;

  const start = startOf(active);
  const siblings = trails.filter((t) => titleKey(startOf(t)) === titleKey(start));
  const index = trails.indexOf(active);
  const next = [...trails.slice(index + 1), ...trails.slice(0, index)].find((t) => titleKey(startOf(t)) !== titleKey(start));
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const total = active.stops.length;

  return (
    <div className={styles.explorer} data-testid="trail-explorer">
      <div className={styles.head} aria-live="polite">
        <Heading className={styles.route} data-testid="trail-route">
          <span>{start}</span>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <span className="visually-hidden"> to </span>
          <span>{endOf(active)}</span>
        </Heading>
        <p className={styles.count}>
          {total} articles · {total - 1} connections
        </p>
      </div>
      {active.origin === "generated" ? (
        <p className={styles.generatedNote} data-testid="trail-generated-note">
          Proposed by AI, then checked against Wikipedia: every article exists, each one links to the next, and each step
          quotes the sentence where it does. The explanations are AI-written.
        </p>
      ) : null}

      <TrailView key={active.id} trail={active} loading={loading} cardHeading={headingLevel === 2 ? "h3" : "h4"} />

      {siblings.length > 1 || next ? (
        <div className={styles.controls}>
          {siblings.length > 1 ? (
            <div className={styles.alternatives} role="group" aria-label={`Trails from ${start}`}>
              <span className={styles.altLabel}>Destinations from {start}:</span>
              {siblings.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="btn"
                  aria-pressed={t.id === active.id}
                  onClick={() => setActiveId(t.id)}
                  data-testid="trail-alternative"
                >
                  {endOf(t)}
                </button>
              ))}
            </div>
          ) : null}
          {next ? (
            <button type="button" className={`btn ${styles.another}`} onClick={() => setActiveId(next.id)} data-testid="trail-another">
              Explore another trail
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
