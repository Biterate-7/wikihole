"use client";

import { GROUPS, SUBTOPICS, groupsForSubtopic } from "@/lib/discovery/topics";
import styles from "./feed.module.css";

/** Two-level topic filter: groups, then the selected group's subtopics. */
export function TopicFilter({ value, onChange }: { value: string | null; onChange: (topic: string | null) => void }) {
  const activeGroup = value ? (GROUPS.find((g) => g.id === value) ?? groupsForSubtopic(value)[0]) : undefined;
  return (
    <div className={styles.filters}>
      <div className={styles.chipRow} role="group" aria-label="Topic">
        <button type="button" className={styles.chip} aria-pressed={value === null} onClick={() => onChange(null)}>
          All
        </button>
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={styles.chip}
            aria-pressed={activeGroup?.id === g.id}
            onClick={() => onChange(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>
      {activeGroup ? (
        <div className={`${styles.chipRow} ${styles.subRow}`} role="group" aria-label={`${activeGroup.label} subtopics`}>
          {activeGroup.subtopics.map((slug) => (
            <button
              key={slug}
              type="button"
              className={styles.subChip}
              aria-pressed={value === slug}
              onClick={() => onChange(value === slug ? activeGroup.id : slug)}
            >
              {SUBTOPICS[slug]?.label ?? slug}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
