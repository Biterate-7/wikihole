import type { Metadata } from "next";
import { ArticleView, articleMetadata } from "@/components/article/ArticleRoute";

type Props = { params: Promise<{ lang: string; slug: string[] }> };

/** The reader for non-English editions; the layout has already validated `lang`. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  return articleMetadata(slug, lang);
}

export default async function LocalizedArticlePage({ params }: Props) {
  const { lang, slug } = await params;
  return <ArticleView slug={slug} lang={lang} />;
}
