"use client";

import { GROUPS, SUBTOPICS, groupsForSubtopic } from "@/lib/discovery/topics";
import styles from "./feed.module.css";

/** Two-level topic filter: groups, then the selected group's subtopics, as link-style toggles. */
export function TopicFilter({ value, onChange }: { value: string | null; onChange: (topic: string | null) => void }) {
  const activeGroup = value ? (GROUPS.find((g) => g.id === value) ?? groupsForSubtopic(value)[0]) : undefined;
  return (
    <div className={styles.filters}>
      <div className={styles.controlRow} role="group" aria-label="Topic">
        <span className={styles.controlLabel}>Topic:</span>
        <ul className={styles.toggleList}>
          <li>
            <button type="button" className={styles.toggle} aria-pressed={value === null} onClick={() => onChange(null)}>
              All
            </button>
          </li>
          {GROUPS.map((g) => (
            <li key={g.id}>
              <button type="button" className={styles.toggle} aria-pressed={activeGroup?.id === g.id} onClick={() => onChange(g.id)}>
                {g.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      {activeGroup ? (
        <div className={`${styles.controlRow} ${styles.subRow}`} role="group" aria-label={`${activeGroup.label} subtopics`}>
          <span className={styles.controlLabel}>{activeGroup.label}:</span>
          <ul className={styles.toggleList}>
            {activeGroup.subtopics.map((slug) => (
              <li key={slug}>
                <button
                  type="button"
                  className={styles.toggle}
                  aria-pressed={value === slug}
                  onClick={() => onChange(value === slug ? activeGroup.id : slug)}
                >
                  {SUBTOPICS[slug]?.label ?? slug}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
