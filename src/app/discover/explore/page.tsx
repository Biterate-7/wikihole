import type { Metadata } from "next";
import { Suspense } from "react";
import { ExploreMethod } from "@/components/curated/CuratedTools";
import { ExploreFeed } from "@/components/curated/ExploreFeed";
import { FeedItemSkeleton } from "@/components/feed/FeedItem";
import { EditionNotice } from "@/components/i18n/EditionNotice";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { PageShell, SiteSub } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import { StateMessage } from "@/components/ui/StateMessage";
import { EXPLORE_AREAS, EXPLORE_SORTS, exploreCatalogue, type ExploreArea, type ExploreSort } from "@/lib/curated/service";
import { getCatalogue, getMeta } from "@/lib/curated/store";
import { requestLanguage } from "@/lib/i18n/server";
import { attempt } from "@/lib/server/http";
import { discoverTabs } from "../tabs";
import styles from "../../pages.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore Wikipedia",
  description: "Browse a structured catalogue of Wikipedia articles, including many nobody has recommended yet.",
};

async function InitialFeed({ query, area, sort, unrecommended }: { query: string; area: ExploreArea | null; sort: ExploreSort; unrecommended: boolean }) {
  if (getCatalogue().entries.length === 0) {
    return (
      <StateMessage kind="empty" title="The catalogue has not been built on this deployment.">
        Nothing is shown rather than made up. See docs/discovery-pipeline.md for how to build it.
      </StateMessage>
    );
  }
  const result = await attempt(() => exploreCatalogue({ query, area, sort, unrecommended, limit: 12 }));
  return <ExploreFeed initial={result.ok ? result.value : null} query={{ query, area, sort, unrecommended }} />;
}

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 120) : "";
  const area = (EXPLORE_AREAS as readonly unknown[]).includes(params.area) ? (params.area as ExploreArea) : null;
  const sort = (EXPLORE_SORTS as readonly unknown[]).includes(params.sort) ? (params.sort as ExploreSort) : "surprise";
  const unrecommended = params.new === "1";
  return (
    <LanguageProvider initialLang={await requestLanguage()}>
      <PageShell title="Explore Wikipedia" tabs={discoverTabs("explore")} tools={<SiteTools><ExploreMethod meta={getMeta()} /></SiteTools>}>
        <SiteSub>Beyond what anyone has recommended</SiteSub>
        <p className={styles.intro}>
          Wikipedia is far larger than what people talk about. Browse a structured catalogue of its articles by subject, quality and how much they are read.
        </p>
        <EditionNotice feature="This catalogue" source="English Wikipedia" />
        <Suspense key={`${query}-${area}-${sort}-${unrecommended}`} fallback={Array.from({ length: 6 }, (_, i) => <FeedItemSkeleton key={i} />)}>
          <InitialFeed query={query} area={area} sort={sort} unrecommended={unrecommended} />
        </Suspense>
      </PageShell>
    </LanguageProvider>
  );
}
