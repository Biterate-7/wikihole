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
import { getLanguage, languageLocale } from "@/lib/i18n/languages";
import { attempt, describeError } from "@/lib/server/http";
import { WikipediaError } from "@/lib/wikipedia/http";
import { articlePath, titleFromSlug, wikipediaUrl } from "@/lib/wikipedia/titles";
import type { PageMeta } from "@/lib/wikipedia/types";

/**
 * The reader, shared by /wiki/<Title> (English) and /<lang>/wiki/<Title>
 * (every other edition). Route files only supply the language.
 */

/**
 * Resolves the article before the page's loading boundary starts streaming,
 * so missing titles get a real HTTP 404 and aliases a real 308 redirect.
 * The metadata lookup is cached and shared with the page.
 */
export async function resolveArticle(slug: string[], lang: string): Promise<void> {
  const title = titleFromSlug(slug);
  if (!title) notFound();
  const meta = await attempt(() => loadMeta(title, lang));
  if (meta.ok) {
    if (meta.value === null) notFound();
    if (meta.value.title !== title) permanentRedirect(articlePath(meta.value.title, undefined, lang));
  } else if (meta.error instanceof WikipediaError && meta.error.kind === "notfound") {
    notFound();
  }
  // Transient Wikipedia failures fall through: the page renders its own error state.
}

export async function articleMetadata(slug: string[], lang: string): Promise<Metadata> {
  const title = titleFromSlug(slug);
  if (!title) return { title: "Article not found" };
  const meta = await loadMeta(title, lang).catch(() => null);
  if (!meta) return { title };
  const description = leadSentences(meta.extract ?? meta.description ?? "", 180);
  return {
    title: meta.title,
    description,
    alternates: { canonical: articlePath(meta.title, undefined, lang) },
    openGraph: {
      type: "article",
      locale: languageLocale(getLanguage(lang)),
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

type Slot = { title: string; lang: string };

async function TocSlot({ title, lang }: Slot) {
  const doc = await attempt(() => loadArticle(title, lang));
  return doc.ok ? <Toc headings={tocHeadings(doc.value)} /> : null;
}

async function BodySlot({ title, lang }: Slot) {
  const doc = await attempt(() => loadArticle(title, lang));
  if (doc.ok) return <ArticleSections doc={doc.value} />;
  return (
      <StateMessage
        kind="error"
        title="The rest of this article could not be loaded."
        action={
          <a className="btn" href={wikipediaUrl(title, lang)} target="_blank" rel="noopener noreferrer">
            Read it on Wikipedia
          </a>
        }
      >
        {describeError(doc.error).message}
      </StateMessage>
  );
}

async function AsideSlot({ title, lang, meta }: Slot & { meta: PageMeta }) {
  const doc = await attempt(() => loadArticle(title, lang));
  return doc.ok ? <ArticleAside doc={doc.value} meta={meta} /> : null;
}

async function RelatedSlot({ title, lang }: Slot) {
  const result = await attempt(async () => {
    const doc = await loadArticle(title, lang);
    return { doc, items: await getRelated(doc) };
  });
  if (result.ok) return <RelatedList items={result.value.items} currentTitle={result.value.doc.title} lang={lang} />;
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

export async function ArticleView({ slug, lang }: { slug: string[]; lang: string }) {
  const title = titleFromSlug(slug);
  if (!title) notFound();
  const language = getLanguage(lang);

  const loaded = await attempt(() => Promise.all([loadMeta(title, lang), loadLead(title, lang)]));
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
                <a className="btn" href={articlePath(title, undefined, lang)}>
                  Try again
                </a>
                <a className="btn" href={wikipediaUrl(title, lang)} target="_blank" rel="noopener noreferrer">
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
  if (meta.title !== title) permanentRedirect(articlePath(meta.title, undefined, lang));

  return (
    <article className={styles.page} data-testid="reader" data-lang={lang}>
      <ReadingProgress targetId="article-body" />
      <div className={`container ${styles.grid}`}>
        <div className={styles.head} lang={languageLocale(language)} dir={language.dir}>
          <TrailTracker title={meta.title} description={meta.description} lang={lang} />
          <ArticleHeader meta={meta} displayTitle={lead.displayTitle} />
        </div>
        <div className={styles.tocCol} lang={languageLocale(language)} dir={language.dir}>
          <Suspense fallback={null}>
            <TocSlot title={meta.title} lang={lang} />
          </Suspense>
        </div>
        <div id="article-body" className={styles.prose} lang={languageLocale(language)} dir={language.dir}>
          <Blocks blocks={proseFirst(lead.lead)} />
          <Suspense fallback={<SectionsSkeleton />}>
            <BodySlot title={meta.title} lang={lang} />
          </Suspense>
        </div>
        <aside className={styles.asideCol} aria-label="About this article">
          <Facts rows={lead.infobox} />
          {isAiEnabled() ? <InsightsPanel title={meta.title} lang={lang} /> : null}
          <Suspense fallback={null}>
            <AsideSlot title={meta.title} lang={lang} meta={meta} />
          </Suspense>
        </aside>
      </div>

      <section id="rabbit-hole" className={`container ${styles.rabbitHole}`} aria-labelledby="rabbit-hole-heading">
        <p className="label">Rabbit hole</p>
        <h2 id="rabbit-hole-heading" className={styles.rabbitTitle}>
          Where <span lang={languageLocale(language)}>{meta.title}</span> leads
        </h2>
        <p className={styles.rabbitSub}>
          Every connection below has a source: a link in this article, a shared Wikipedia category, or CirrusSearch
          text similarity. Articles already on your trail are left out.
        </p>
        <Suspense fallback={<RelatedSkeleton />}>
          <RelatedSlot title={meta.title} lang={lang} />
        </Suspense>
      </section>
    </article>
  );
}
