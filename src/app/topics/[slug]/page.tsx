import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DiscoveryFeed } from "@/components/feed/DiscoveryFeed";
import { PageShell } from "@/components/layout/PageShell";
import { Portlet } from "@/components/layout/Portlet";
import { SiteTools } from "@/components/layout/SiteTools";
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
    <PageShell
      title={topic.label}
      tabs={{
        left: [
          { label: "Topic", href: `/topics/${slug}`, selected: true },
          { label: "All topics", href: "/topics" },
        ],
        right: [
          { label: "Read", href: `/topics/${slug}`, selected: true },
          { label: "Discover", href: `/discover?topic=${slug}` },
        ],
      }}
      tools={
        <SiteTools>
          {group ? (
            <Portlet
              id="tools-collections"
              heading={`${group.label} collections`}
              items={[
                { href: `/topics/${group.id}`, label: `All of ${group.label}`, current: slug === group.id },
                ...group.subtopics.map((s) => ({ href: `/topics/${s}`, label: SUBTOPICS[s].label, current: s === slug })),
              ]}
            />
          ) : null}
        </SiteTools>
      }
    >
      <nav className={styles.subpages} aria-label="Breadcrumb">
        &lt; <Link href="/topics">Topics</Link>
        {topic.kind === "subtopic" && group ? (
          <>
            {" | "}
            <Link href={`/topics/${group.id}`}>{group.label}</Link>
          </>
        ) : null}
      </nav>
      {topic.kind === "group" && group ? <p className={styles.intro}>{group.blurb}</p> : null}
      {group ? (
        <nav className={styles.subtopicNav} aria-label={`${group.label} collections`}>
          <b>{group.label}:</b>{" "}
          {group.subtopics.map((s, i) => (
            <span key={s}>
              {i ? " · " : ""}
              <Link href={`/topics/${s}`} aria-current={s === slug ? "page" : undefined}>
                {SUBTOPICS[s].label}
              </Link>
            </span>
          ))}
        </nav>
      ) : null}
      {topic.kind === "subtopic" ? (
        <div className={styles.catlinks}>
          Sampled from Wikipedia categories:{" "}
          <ul>
            {categories.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <EditionNotice feature="Topics" />
      <Suspense key={slug} fallback={<DiscoveryFeed initial={null} pending topic={slug} preset="balanced" fixedTopic />}>
        <TopicFeed slug={slug} />
      </Suspense>
    </PageShell>
  );
}
