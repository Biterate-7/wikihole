import type { Metadata } from "next";
import Link from "next/link";
import { GROUPS, SUBTOPICS } from "@/lib/discovery/topics";
import styles from "../pages.module.css";

export const metadata: Metadata = {
  title: "Topics",
  description: "Curated collections of technical Wikipedia topics, each a live, ranked stream of real articles.",
};

export default function TopicsPage() {
  return (
    <div className="container">
      <header className={styles.pageHead}>
        <p className="label">Topics</p>
        <h1 className={styles.pageTitle}>Pick a hole to fall into.</h1>
        <p className={styles.pageSub}>
          Each collection is defined by real Wikipedia categories. Opening one samples those categories at random, filters
          out stubs and trivia, and ranks what is left.
        </p>
      </header>
      <div className={styles.topicGroups}>
        {GROUPS.map((group) => (
          <section key={group.id} className={styles.topicGroup} aria-labelledby={`group-${group.id}`}>
            <div className={styles.topicGroupHead}>
              <h2 id={`group-${group.id}`} className={styles.topicGroupTitle}>
                <Link href={`/topics/${group.id}`}>{group.label}</Link>
              </h2>
              <span className="label">{group.subtopics.length} collections</span>
            </div>
            <p className={styles.topicBlurb}>{group.blurb}</p>
            <ul className={styles.subtopicList}>
              {group.subtopics.map((slug) => {
                const sub = SUBTOPICS[slug];
                return (
                  <li key={slug}>
                    <Link href={`/topics/${slug}`}>
                      <span>{sub.label}</span>
                      <span className="label">{sub.categories.length} categories</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
