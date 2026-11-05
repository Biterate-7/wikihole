import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import {
  ArticleSections,
  ArticleTools,
  Catlinks,
  Infobox,
  KeyConcepts,
  SectionsSkeleton,
  StudyNavbox,
} from "@/components/article/ArticleParts";
import { Blocks } from "@/components/article/Blocks";
import { InsightsPanel } from "@/components/article/InsightsPanel";
import { ReadingProgress } from "@/components/article/ReadingProgress";
import { RelatedList } from "@/components/article/RelatedList";
import { Toc, TocDropdown } from "@/components/article/Toc";
import { TrailTracker } from "@/components/article/TrailTracker";
import styles from "@/components/article/article.module.css";
import { PageShell, SiteSub } from "@/components/layout/PageShell";
import { StateMessage } from "@/components/ui/StateMessage";
import { SaveButton } from "@/components/ui/SaveButton";
import { isAiEnabled } from "@/lib/ai/config";
import { loadArticle, loadLead, loadMeta } from "@/lib/article";
import type { ArticleDocument, Block, Heading, WikiImage } from "@/lib/content/types";
import { classifyGroup, readingMinutes } from "@/lib/discovery/score";
import { getRelated } from "@/lib/discovery/engine";
import { GROUPS } from "@/lib/discovery/topics";
import { leadSentences } from "@/lib/format";
import { DEFAULT_LANGUAGE, getLanguage, languageLocale } from "@/lib/i18n/languages";
import { attempt, describeError } from "@/lib/server/http";
import { WikipediaError } from "@/lib/wikipedia/http";
import { articlePath, titleFromSlug } from "@/lib/wikipedia/titles";
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

/** A Wikimedia file's name, whatever thumbnail size the URL asks for. */
function fileName(src: string): string {
  const last = src.split("?")[0].split("/").pop() ?? src;
  return decodeURIComponent(last).replace(/^(?:lossy-|lossless-)?(?:page\d+-)?\d+px-/, "");
}

/** The infobox shows the lead image, so the same file is not repeated as a thumbnail beside it. */
function withoutImage(blocks: Block[], image: WikiImage | undefined): Block[] {
  if (!image) return blocks;
  const name = fileName(image.src);
  return blocks.filter((b) => !(b.k === "figure" && fileName(b.img.src) === name));
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

async function TocDropdownSlot({ title, lang }: Slot) {
  const doc = await attempt(() => loadArticle(title, lang));
  return doc.ok ? <TocDropdown headings={tocHeadings(doc.value)} /> : null;
}

async function BodySlot({ title, lang }: Slot) {
  const doc = await attempt(() => loadArticle(title, lang));
  if (doc.ok) return <ArticleSections doc={doc.value} />;
  return (
    <StateMessage
      kind="error"
      title="The rest of this article could not be loaded."
      action={
        <a className="btn" href={articlePath(title, undefined, lang)}>
          Try again
        </a>
      }
    >
      {describeError(doc.error).message}
    </StateMessage>
  );
}

async function ToolsSlot({ title, lang, meta }: Slot & { meta: PageMeta }) {
  const doc = await attempt(() => loadArticle(title, lang));
  return <ArticleTools meta={meta} concepts={doc.ok ? <KeyConcepts doc={doc.value} /> : null} />;
}

async function FooterSlot({ title, lang }: Slot) {
  const doc = await attempt(() => loadArticle(title, lang));
  if (!doc.ok) return null;
  return <StudyNavbox doc={doc.value} />;
}

async function CatlinksSlot({ title, lang }: Slot) {
  const doc = await attempt(() => loadArticle(title, lang));
  return doc.ok ? <Catlinks doc={doc.value} /> : null;
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
          <div className="skeleton" style={{ width: "40%", height: 16, marginBottom: 8 }} />
          <div className="skeleton" style={{ width: "95%", height: 12, marginBottom: 6 }} />
          <div className="skeleton" style={{ width: "70%", height: 12 }} />
        </div>
      ))}
    </div>
  );
}

function articleTabs(title: string, lang: string) {
  return {
    left: [
      { label: "Article", href: articlePath(title, undefined, lang), selected: true },
      { label: "Rabbit hole", href: "#rabbit-hole", title: "Related articles and where they lead" },
    ],
    right: [
      { label: "Read", href: articlePath(title, undefined, lang), selected: true },
    ],
  };
}

function siteSub(lang: string): string {
  return lang === DEFAULT_LANGUAGE ? "From Wikipedia, the free encyclopedia" : `From ${getLanguage(lang).englishName} Wikipedia, the free encyclopedia`;
}

export async function ArticleView({ slug, lang }: { slug: string[]; lang: string }) {
  const title = titleFromSlug(slug);
  if (!title) notFound();
  const language = getLanguage(lang);
  const locale = languageLocale(language);

  const loaded = await attempt(() => Promise.all([loadMeta(title, lang), loadLead(title, lang)]));
  if (!loaded.ok) {
    if (loaded.error instanceof WikipediaError && loaded.error.kind === "notfound") notFound();
    return (
      <PageShell title={title} titleLang={locale} tabs={articleTabs(title, lang)}>
        <StateMessage
          kind="error"
          title={`“${title}” could not be loaded.`}
          action={
            <a className="btn" href={articlePath(title, undefined, lang)}>
              Try again
            </a>
          }
        >
          {describeError(loaded.error).message}
        </StateMessage>
      </PageShell>
    );
  }
  const [meta, lead] = loaded.value;
  if (!meta) notFound();
  if (meta.title !== title) permanentRedirect(articlePath(meta.title, undefined, lang));

  const group = GROUPS.find((g) => g.id === classifyGroup(meta));
  const slot = { title: meta.title, lang };
  const image = lead.infoboxImage ?? (meta.thumbnail ? { ...meta.thumbnail, alt: "" } : undefined);

  return (
    <article className={styles.page} data-testid="reader" data-lang={lang}>
      <ReadingProgress targetId="article-body" />
      <PageShell
        start="toc"
        toc={
          <Suspense fallback={null}>
            <TocSlot {...slot} />
          </Suspense>
        }
        titleStart={
          <Suspense fallback={null}>
            <TocDropdownSlot {...slot} />
          </Suspense>
        }
        title={lead.displayTitle}
        titleLang={locale}
        titleDir={language.dir}
        tabs={articleTabs(meta.title, lang)}
        actions={
          <SaveButton
            variant="star"
            article={{
              title: meta.title,
              description: meta.description,
              extract: meta.extract ? leadSentences(meta.extract, 300) : undefined,
              thumbnail: meta.thumbnail,
              readingMinutes: readingMinutes(meta),
              groupLabel: group?.label,
              ...(meta.lang ? { lang: meta.lang } : {}),
            }}
          />
        }
        tools={
          <Suspense fallback={<ArticleTools meta={meta} concepts={null} />}>
            <ToolsSlot {...slot} meta={meta} />
          </Suspense>
        }
      >
        <SiteSub>{siteSub(lang)}</SiteSub>
        <TrailTracker title={meta.title} description={meta.description} lang={lang} />
        <div id="article-body" className={styles.prose} lang={locale} dir={language.dir}>
          <Infobox title={meta.title} rows={lead.infobox} image={image} description={meta.description} />
          <Blocks blocks={proseFirst(withoutImage(lead.lead, image))} />
          <Suspense fallback={<SectionsSkeleton />}>
            <BodySlot {...slot} />
          </Suspense>
          <Suspense fallback={null}>
            <FooterSlot {...slot} />
          </Suspense>
        </div>

        {isAiEnabled() ? <InsightsPanel title={meta.title} lang={lang} /> : null}

        <section id="rabbit-hole" className={styles.rabbitHole} aria-labelledby="rabbit-hole-heading">
          <h2 id="rabbit-hole-heading" className={styles.h2}>
            Rabbit hole
          </h2>
          <p className={styles.hatnote}>
            Where <span lang={locale}>{meta.title}</span> leads. Every connection below has a source: a link in this
            article, a shared Wikipedia category, or CirrusSearch text similarity. Articles already on your trail are
            left out.
          </p>
          <Suspense fallback={<RelatedSkeleton />}>
            <RelatedSlot {...slot} />
          </Suspense>
        </section>

        <Suspense fallback={null}>
          <CatlinksSlot {...slot} />
        </Suspense>
      </PageShell>
    </article>
  );
}
