import type { Metadata } from "next";
import { Suspense } from "react";
import { HackerNewsFeed } from "@/components/hackernews/HackerNewsFeed";
import { HnRankingExplainer } from "@/components/hackernews/HnRankingExplainer";
import { FEED_CATEGORIES, getHackerNewsFeed, type FeedCategory } from "@/lib/hackernews/service";
import { attempt, describeError, runAfter } from "@/lib/server/http";
import styles from "../pages.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hacker News",
  description: "Intellectually interesting Hacker News submissions, each turned into a rabbit hole of connected Wikipedia articles.",
};

function parseCategory(value: unknown): FeedCategory {
  return typeof value === "string" && (FEED_CATEGORIES as string[]).includes(value) ? (value as FeedCategory) : "all";
}

async function InitialFeed({ category }: { category: FeedCategory }) {
  const result = await attempt(() => getHackerNewsFeed({ category, schedule: runAfter }));
  return result.ok ? (
    <HackerNewsFeed initial={result.value} category={category} />
  ) : (
    <HackerNewsFeed initial={null} initialError={describeError(result.error).message} category={category} />
  );
}

export default async function HackerNewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const category = parseCategory((await searchParams).category);
  return (
    <div className="container">
      <header className={styles.pageHead}>
        <p className="label">Hacker News</p>
        <h1 className={styles.pageTitle}>What today&rsquo;s Hacker News can teach you.</h1>
        <p className={styles.pageSub}>
          Technical and intellectually interesting submissions, each read for what it is actually about and turned into a
          rabbit hole of connected Wikipedia articles. Hacker News finds the topics; Wikipedia explains them.
        </p>
      </header>
      <div className={styles.homeGrid}>
        <Suspense key={category} fallback={<HackerNewsFeed initial={null} pending category={category} />}>
          <InitialFeed category={category} />
        </Suspense>
        <aside className={styles.rail} aria-label="About this feed">
          <HnRankingExplainer />
        </aside>
      </div>
    </div>
  );
}
