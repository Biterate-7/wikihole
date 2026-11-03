import { notFound, permanentRedirect } from "next/navigation";
import { resolveArticle } from "@/components/article/ArticleRoute";
import { DEFAULT_LANGUAGE, isSupportedLanguage } from "@/lib/i18n/languages";
import { articlePath, titleFromSlug } from "@/lib/wikipedia/titles";

/**
 * /<lang>/wiki/<Title>: unknown editions 404, /en/wiki/... redirects to the
 * canonical /wiki/... path, and titles resolve as for English articles.
 */
export default async function LocalizedArticleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string; slug: string[] }>;
}) {
  const { lang, slug } = await params;
  if (!isSupportedLanguage(lang)) notFound();
  if (lang === DEFAULT_LANGUAGE) permanentRedirect(articlePath(titleFromSlug(slug) ?? ""));
  await resolveArticle(slug, lang);
  return children;
}
