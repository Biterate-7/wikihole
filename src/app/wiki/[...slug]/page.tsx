import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { ArticleAside, ArticleHeader, ArticleSections, Facts, SectionsSkeleton } from "@/components/article/ArticleParts";
import { Blocks } from "@/components/article/Blocks";
import { InsightsPanel } from "@/components/article/InsightsPanel";
import { ReadingProgress } from "@/components/article/ReadingProgress";
import { RelatedList } from "@/components/article/RelatedList";
import { Toc } from "@/components/article/Toc";
import { TrailTracker } from "@/components/article/TrailTracker";
import styles from "@/components/article/article.module.css";
import { StateMessage } from "@/components/ui/StateMessage";
import { isAiEnabled } from "@/lib/ai/config";
import { loadArticle, loadLead, loadMeta } from "@/lib/article";
import type { ArticleDocument, Block, Heading } from "@/lib/content/types";
import { getRelated } from "@/lib/discovery/engine";
import { leadSentences } from "@/lib/format";
import { attempt, describeError } from "@/lib/server/http";
import { WikipediaError } from "@/lib/wikipedia/http";
import { articlePath, titleFromSlug, wikipediaUrl } from "@/lib/wikipedia/titles";
import type { PageMeta } from "@/lib/wikipedia/types";

type Props = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const title = titleFromSlug(slug);
  if (!title) return { title: "Article not found" };
  const meta = await loadMeta(title).catch(() => null);
  if (!meta) return { title };
  const description = leadSentences(meta.extract ?? meta.description ?? "", 180);
  return {
    title: meta.title,
    description,
    alternates: { canonical: articlePath(meta.title) },
    openGraph: {
      type: "article",
      title: `${meta.title} · WikiHole`,
      description,
      images: meta.thumbnail ? [{ url: meta.thumbnail.src, width: meta.thumbnail.width, height: meta.thumbnail.height }] : undefined,
    },
  };
}

/** Puts the first lead paragraph ahead of lead images/hatnotes so prose comes first. */
function proseFirst(blocks: Block[]): Block[] {
  const index = blocks.findIndex((b) => b.k === "p");
  if (index <= 0) return blocks;
  return [blocks[index], ...blocks.slice(0, index), ...blocks.slice(index + 1)];
}

function tocHeadings(doc: ArticleDocument): Heading[] {
  return doc.sections.flatMap((s) => [
    { id: s.id, text: s.title, level: 2 as const },
    ...s.headings.filter((h) => h.level === 3),
  ]);
}

async function TocSlot({ title }: { title: string }) {
  const doc = await attempt(() => loadArticle(title));
  return doc.ok ? <Toc headings={tocHeadings(doc.value)} /> : null;
}

async function BodySlot({ title }: { title: string }) {
  const doc = await attempt(() => loadArticle(title));
  if (doc.ok) return <ArticleSections doc={doc.value} />;
  return (
      <StateMessage
        kind="error"
        title="The rest of this article could not be loaded."
        action={
          <a className="btn" href={wikipediaUrl(title)} target="_blank" rel="noopener noreferrer">
            Read it on Wikipedia
          </a>
        }
      >
        {describeError(doc.error).message}
      </StateMessage>
  );
}

async function AsideSlot({ title, meta }: { title: string; meta: PageMeta }) {
  const doc = await attempt(() => loadArticle(title));
  return doc.ok ? <ArticleAside doc={doc.value} meta={meta} /> : null;
}

async function RelatedSlot({ title }: { title: string }) {
  const result = await attempt(async () => {
    const doc = await loadArticle(title);
    return { doc, items: await getRelated(doc) };
  });
  if (result.ok) return <RelatedList items={result.value.items} currentTitle={result.value.doc.title} />;
  return (
    <StateMessage kind="error" title="Related articles are unavailable right now.">
      {describeError(result.error).message}
    </StateMessage>
  );
}

function RelatedSkeleton() {
  return (
    <div aria-hidden="true" className={styles.relatedList}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.related}>
          <div className="skeleton" style={{ width: 140, height: 10, marginBottom: 12 }} />
          <div className="skeleton" style={{ width: "70%", height: 18, marginBottom: 10 }} />
          <div className="skeleton" style={{ width: "95%", height: 12 }} />
        </div>
      ))}
    </div>
  );
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const title = titleFromSlug(slug);
  if (!title) notFound();

  const loaded = await attempt(() => Promise.all([loadMeta(title), loadLead(title)]));
  if (!loaded.ok) {
    if (loaded.error instanceof WikipediaError && loaded.error.kind === "notfound") notFound();
    return (
      <div className="container">
        <div className={styles.unavailable}>
          <StateMessage
            kind="error"
            title={`“${title}” could not be loaded.`}
            action={
              <>
                <a className="btn" href={articlePath(title)}>
                  Try again
                </a>
                <a className="btn" href={wikipediaUrl(title)} target="_blank" rel="noopener noreferrer">
                  Open on Wikipedia
                </a>
              </>
            }
          >
            {describeError(loaded.error).message}
          </StateMessage>
        </div>
      </div>
    );
  }
  const [meta, lead] = loaded.value;
  if (!meta) notFound();
  if (meta.title !== title) permanentRedirect(articlePath(meta.title));

  return (
    <article className={styles.page} data-testid="reader">
      <ReadingProgress targetId="article-body" />
      <div className={`container ${styles.grid}`}>
        <div className={styles.head}>
          <TrailTracker title={meta.title} description={meta.description} />
          <ArticleHeader meta={meta} displayTitle={lead.displayTitle} />
        </div>
        <div className={styles.tocCol}>
          <Suspense fallback={null}>
            <TocSlot title={meta.title} />
          </Suspense>
        </div>
        <div id="article-body" className={styles.prose}>
          <Blocks blocks={proseFirst(lead.lead)} />
          <Suspense fallback={<SectionsSkeleton />}>
            <BodySlot title={meta.title} />
          </Suspense>
        </div>
        <aside className={styles.asideCol} aria-label="About this article">
          <Facts rows={lead.infobox} />
          {isAiEnabled() ? <InsightsPanel title={meta.title} /> : null}
          <Suspense fallback={null}>
            <AsideSlot title={meta.title} meta={meta} />
          </Suspense>
        </aside>
      </div>

      <section id="rabbit-hole" className={`container ${styles.rabbitHole}`} aria-labelledby="rabbit-hole-heading">
        <p className="label">Rabbit hole</p>
        <h2 id="rabbit-hole-heading" className={styles.rabbitTitle}>
          Where {meta.title} leads
        </h2>
        <p className={styles.rabbitSub}>
          Every connection below has a source: a link in this article, a shared Wikipedia category, or CirrusSearch
          text similarity. Articles already on your trail are left out.
        </p>
        <Suspense fallback={<RelatedSkeleton />}>
          <RelatedSlot title={meta.title} />
        </Suspense>
      </section>
    </article>
  );
}
