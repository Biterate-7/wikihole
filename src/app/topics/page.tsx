import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, SiteSub } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import { GROUPS, SUBTOPICS } from "@/lib/discovery/topics";
import { EditionNotice } from "@/components/i18n/EditionNotice";
import styles from "../pages.module.css";

export const metadata: Metadata = {
  title: "Topics",
  description: "Curated collections of technical Wikipedia topics, each a live, ranked stream of real articles.",
};

/** The topic index, laid out like Wikipedia's Contents portal: a heading per area and its collections. */
export default function TopicsPage() {
  return (
    <PageShell
      title="Topics"
      tabs={{
        left: [{ label: "Topics", href: "/topics", selected: true }],
        right: [
          { label: "Read", href: "/topics", selected: true },
          { label: "Discover", href: "/discover" },
        ],
      }}
      tools={<SiteTools />}
    >
      <SiteSub>Pick a hole to fall into</SiteSub>
      <p className={styles.intro}>
        Each collection is defined by real Wikipedia categories. Opening one samples those categories at random, filters
        out stubs and trivia, and ranks what is left.
      </p>
      <EditionNotice feature="Topics" />
      <div className={styles.contentsBox}>
        <b>Contents</b>
        <ul>
          {GROUPS.map((group) => (
            <li key={group.id}>
              <a href={`#group-${group.id}`}>{group.label}</a>
            </li>
          ))}
        </ul>
      </div>
      {GROUPS.map((group) => (
        <section key={group.id} className={styles.topicGroup} aria-labelledby={`group-${group.id}`}>
          <h2 id={`group-${group.id}`} className={styles.h2}>
            <Link href={`/topics/${group.id}`}>{group.label}</Link>
          </h2>
          <p className={styles.topicBlurb}>
            {group.blurb} <span className={styles.muted}>({group.subtopics.length} collections)</span>
          </p>
          <ul className={styles.subtopicList}>
            {group.subtopics.map((slug) => {
              const sub = SUBTOPICS[slug];
              return (
                <li key={slug}>
                  <Link href={`/topics/${slug}`}>{sub.label}</Link>{" "}
                  <span className={styles.muted}>({sub.categories.length} categories)</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </PageShell>
  );
}
