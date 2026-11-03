import { resolveArticle } from "@/components/article/ArticleRoute";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";

/** Gives missing titles a real 404 and aliases a real 308 before the loading boundary streams. */
export default async function ArticleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string[] }>;
}) {
  await resolveArticle((await params).slug, DEFAULT_LANGUAGE);
  return children;
}
