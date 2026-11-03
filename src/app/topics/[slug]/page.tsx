import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DiscoveryFeed } from "@/components/feed/DiscoveryFeed";
import { getFeed } from "@/lib/discovery/engine";
import { SUBTOPICS, resolveTopic } from "@/lib/discovery/topics";
import { attempt, describeError } from "@/lib/server/http";
import { EditionNotice } from "@/components/i18n/EditionNotice";
import styles from "../../pages.module.css";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const topic = resolveTopic((await params).slug);
  if (!topic) return { title: "Topic not found" };
  return {
    title: topic.label,
    description: topic.group && topic.kind === "group" ? topic.group.blurb : `Obscure, technical Wikipedia articles on ${topic.label.toLowerCase()}.`,
  };
}

async function TopicFeed({ slug }: { slug: string }) {
  const result = await attempt(() => getFeed({ topic: slug, limit: 12 }));
  return result.ok ? (
    <DiscoveryFeed initial={result.value} topic={slug} preset="balanced" fixedTopic />
  ) : (
    <DiscoveryFeed initial={null} initialError={describeError(result.error).message} topic={slug} preset="balanced" fixedTopic />
  );
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;
  const topic = resolveTopic(slug);
  if (!topic) notFound();
  const group = topic.group;
  const categories = topic.subtopics.flatMap((s) => s.categories);

  return (
    <div className={`container ${styles.narrow}`}>
      <header className={styles.pageHead}>
        <p className={`label ${styles.breadcrumb}`}>
          <Link href="/topics">Topics</Link>
          {topic.kind === "subtopic" && group ? (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/topics/${group.id}`}>{group.label}</Link>
            </>
          ) : null}
        </p>
        <h1 className={styles.pageTitle}>{topic.label}</h1>
        {topic.kind === "group" && group ? <p className={styles.pageSub}>{group.blurb}</p> : null}
        {group ? (
          <nav className={styles.subtopicNav} aria-label={`${group.label} collections`}>
            {group.subtopics.map((s) => (
              <Link key={s} href={`/topics/${s}`} aria-current={s === slug ? "page" : undefined}>
                {SUBTOPICS[s].label}
              </Link>
            ))}
          </nav>
        ) : null}
        {topic.kind === "subtopic" ? (
          <p className={styles.categoryList}>
            Sampled from Wikipedia categories: {categories.map((c) => `“${c}”`).join(", ")}.
          </p>
        ) : null}
      </header>
      <EditionNotice feature="Topics" />
      <Suspense key={slug} fallback={<DiscoveryFeed initial={null} pending topic={slug} preset="balanced" fixedTopic />}>
        <TopicFeed slug={slug} />
      </Suspense>
    </div>
  );
}
