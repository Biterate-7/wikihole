import type { Metadata } from "next";
import { ArticleView, articleMetadata } from "@/components/article/ArticleRoute";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";

type Props = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return articleMetadata((await params).slug, DEFAULT_LANGUAGE);
}

export default async function ArticlePage({ params }: Props) {
  return <ArticleView slug={(await params).slug} lang={DEFAULT_LANGUAGE} />;
}
