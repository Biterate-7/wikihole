import { Suspense } from "react";
import { ContinuePanel } from "@/components/feed/ContinuePanel";
import { DiscoveryFeed } from "@/components/feed/DiscoveryFeed";
import { RankingExplainer } from "@/components/feed/RankingExplainer";
import { SearchBox } from "@/components/search/SearchBox";
import { getFeed } from "@/lib/discovery/engine";
import { isTopicSlug } from "@/lib/discovery/topics";
import type { FeedPreset } from "@/lib/discovery/types";
import { attempt, describeError } from "@/lib/server/http";
import { EditionNotice } from "@/components/i18n/EditionNotice";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { requestLanguage } from "@/lib/i18n/server";
import styles from "../pages.module.css";

export const dynamic = "force-dynamic";

function parsePreset(value: unknown): FeedPreset {
  return value === "deep" || value === "obscure" ? value : "balanced";
}

async function InitialFeed({ topic, preset }: { topic: string | null; preset: FeedPreset }) {
  const result = await attempt(() => getFeed({ topic, preset, limit: 12 }));
  return result.ok ? (
    <DiscoveryFeed initial={result.value} topic={topic} preset={preset} />
  ) : (
    <DiscoveryFeed initial={null} initialError={describeError(result.error).message} topic={topic} preset={preset} />
  );
}

export const metadata = { title: "Discover" };

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const topic = typeof params.topic === "string" && isTopicSlug(params.topic) ? params.topic : null;
  const preset = parsePreset(params.mode);

  return (
    <LanguageProvider initialLang={await requestLanguage()}>
      <div className="container">
        <section className={styles.hero} aria-labelledby="hero-title">
          <p className={`label ${styles.heroKicker}`} id="hero-title">
            WikiHole
          </p>
          <h1 className={styles.heroTagline}>The internet&rsquo;s deepest rabbit holes.</h1>
          <p className={styles.heroSub}>
            A live, ranked stream of obscure and technically deep Wikipedia articles, sampled from computer science,
            mathematics, physics, engineering, biology and economics. Open one, and follow its links as far down as you
            like.
          </p>
          <div className={styles.heroSearch} data-hero-search>
            <SearchBox variant="hero" />
          </div>
        </section>

        <EditionNotice feature="The Discover feed" />

        <div className={styles.homeGrid}>
          <Suspense key={`${topic}-${preset}`} fallback={<DiscoveryFeed initial={null} pending topic={topic} preset={preset} />}>
            <InitialFeed topic={topic} preset={preset} />
          </Suspense>
          <aside className={styles.rail} aria-label="About this feed">
            <ContinuePanel />
            <RankingExplainer />
          </aside>
        </div>
      </div>
    </LanguageProvider>
  );
}
