import type { Metadata } from "next";
import { Suspense } from "react";
import { ContinuePanel } from "@/components/feed/ContinuePanel";
import { FeedItemSkeleton } from "@/components/feed/FeedItem";
import { RecommendedMethod } from "@/components/curated/CuratedTools";
import { RecommendedFeed, type RecommendedView } from "@/components/curated/RecommendedFeed";
import { EditionNotice } from "@/components/i18n/EditionNotice";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { PageShell, SiteSub } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import { StateMessage } from "@/components/ui/StateMessage";
import { COLLECTIONS, type CollectionId } from "@/lib/curated/rank";
import { getCollection, hasRecommendations } from "@/lib/curated/service";
import { getMeta } from "@/lib/curated/store";
import { requestLanguage } from "@/lib/i18n/server";
import { attempt } from "@/lib/server/http";
import { discoverTabs } from "../tabs";
import styles from "../../pages.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recommended",
  description: "Wikipedia articles that people genuinely recommend to each other, with the evidence for each one.",
};

function parseView(value: unknown): RecommendedView {
  if (value === "for-you") return value;
  return (COLLECTIONS as readonly unknown[]).includes(value) ? (value as CollectionId) : "most";
}

async function InitialFeed({ view }: { view: RecommendedView }) {
  if (!hasRecommendations()) {
    return (
      <StateMessage kind="empty" title="The recommendation dataset has not been built on this deployment.">
        Nothing is shown rather than made up. See docs/discovery-pipeline.md for how to build it.
      </StateMessage>
    );
  }
  if (view === "for-you") return <RecommendedFeed initial={null} view={view} />;
  const result = await attempt(() => getCollection(view));
  return <RecommendedFeed initial={result.ok ? result.value : null} view={view} />;
}

export default async function RecommendedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const view = parseView(params.c);
  return (
    <LanguageProvider initialLang={await requestLanguage()}>
      <PageShell
        title="Recommended"
        tabs={discoverTabs("recommended")}
        tools={
          <SiteTools>
            <ContinuePanel />
            <RecommendedMethod meta={getMeta()} />
          </SiteTools>
        }
      >
        <SiteSub>What people actually recommend</SiteSub>
        <p className={styles.intro}>
          Wikipedia articles that people have told each other to read, found in public discussions and counted only when someone genuinely recommends them. Every number links
          back to what was said.
        </p>
        <EditionNotice feature="This list" source="public discussions of English Wikipedia articles" />
        <Suspense key={view} fallback={Array.from({ length: 6 }, (_, i) => <FeedItemSkeleton key={i} />)}>
          <InitialFeed view={view} />
        </Suspense>
      </PageShell>
    </LanguageProvider>
  );
}
