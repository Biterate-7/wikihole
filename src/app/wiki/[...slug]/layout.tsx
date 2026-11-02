import { notFound, permanentRedirect } from "next/navigation";
import { loadMeta } from "@/lib/article";
import { attempt } from "@/lib/server/http";
import { WikipediaError } from "@/lib/wikipedia/http";
import { articlePath, titleFromSlug } from "@/lib/wikipedia/titles";

/**
 * Resolves the article before the page's loading boundary starts streaming,
 * so missing titles get a real HTTP 404 and aliases a real 308 redirect.
 * The metadata lookup is cached and shared with the page.
 */
export default async function ArticleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string[] }>;
}) {
  const title = titleFromSlug((await params).slug);
  if (!title) notFound();
  const meta = await attempt(() => loadMeta(title));
  if (meta.ok) {
    if (meta.value === null) notFound();
    if (meta.value.title !== title) permanentRedirect(articlePath(meta.value.title));
  } else if (meta.error instanceof WikipediaError && meta.error.kind === "notfound") {
    notFound();
  }
  // Transient Wikipedia failures fall through: the page renders its own error state.
  return children;
}
