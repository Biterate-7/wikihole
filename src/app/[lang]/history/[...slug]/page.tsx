import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { historyMetadata, HistoryView, type HistorySearch } from "@/components/history/HistoryRoute";
import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/lib/i18n/languages";
import { historyPath, titleFromSlug } from "@/lib/wikipedia/titles";

type Props = { params: Promise<{ lang: string; slug: string[] }>; searchParams: Promise<HistorySearch> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  return historyMetadata(slug, isSupportedLanguage(lang) ? lang : DEFAULT_LANGUAGE, await searchParams);
}

/** Revision history for non-English editions, validated the same way as their articles. */
export default async function LocalizedHistoryPage({ params, searchParams }: Props) {
  const { lang, slug } = await params;
  if (!isSupportedLanguage(lang)) notFound();
  if (lang === DEFAULT_LANGUAGE) permanentRedirect(historyPath(titleFromSlug(slug) ?? ""));
  return <HistoryView slug={slug} lang={lang} search={await searchParams} />;
}
