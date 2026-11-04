import type { Metadata } from "next";
import { historyMetadata, HistoryView, type HistorySearch } from "@/components/history/HistoryRoute";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";

type Props = { params: Promise<{ slug: string[] }>; searchParams: Promise<HistorySearch> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  return historyMetadata((await params).slug, DEFAULT_LANGUAGE, await searchParams);
}

export default async function HistoryPage({ params, searchParams }: Props) {
  return <HistoryView slug={(await params).slug} lang={DEFAULT_LANGUAGE} search={await searchParams} />;
}
