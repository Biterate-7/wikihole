import Link from "next/link";
import { Portlet } from "@/components/layout/Portlet";
import { PrintLink } from "@/components/layout/PrintLink";
import layout from "@/components/layout/layout.module.css";
import { equations, keyConcepts, terminology } from "@/lib/content/concepts";
import { inlineText } from "@/lib/content/parse";
import type { ArticleDocument, Block, InfoboxRow, Section, WikiImage } from "@/lib/content/types";
import { classifyGroup, readingMinutes, sourcedDate } from "@/lib/discovery/score";
import { GROUPS } from "@/lib/discovery/topics";
import { ASSESSMENT_LABELS, formatCount, formatDate } from "@/lib/format";
import { DEFAULT_LANGUAGE, wikipediaDomain } from "@/lib/i18n/languages";
import { articlePath, historyPath, wikipediaUrl } from "@/lib/wikipedia/titles";
import { PAGEVIEW_DAYS, type PageMeta } from "@/lib/wikipedia/types";
import { Blocks } from "./Blocks";
import { InlineContent, MathView } from "./Inline";
import { SectionSummary } from "./SectionSummary";
import styles from "./article.module.css";

const wikiPage = (domain: string, title: string) => `https://${domain}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
const wikiAction = (domain: string, title: string, action: string) =>
  `https://${domain}/w/index.php?title=${encodeURIComponent(title.replace(/ /g, "_"))}&action=${action}`;

/** Links for the article's view tabs and tools, on its own Wikipedia edition. */
export function wikipediaLinks(title: string, lang = DEFAULT_LANGUAGE) {
  const domain = wikipediaDomain(lang);
  return {
    history: wikiAction(domain, title, "history"),
    info: wikiAction(domain, title, "info"),
    whatLinksHere: wikiPage(domain, `Special:WhatLinksHere/${title}`),
    category: (name: string) => wikiPage(domain, `Category:${name}`),
    revision: (revId: number) => `https://${domain}/w/index.php?oldid=${revId}`,
    domain,
  };
}

/** The article's namespace and view tabs. The history page shares them, so it marks a different tab as current. */
export function articleTabs(title: string, lang: string, view: "read" | "history" = "read") {
  return {
    left: [
      { label: "Article", href: articlePath(title, undefined, lang), selected: view === "read" },
      { label: "Rabbit hole", href: `${view === "read" ? "" : articlePath(title, undefined, lang)}#rabbit-hole`, title: "Related articles and where they lead" },
    ],
    right: [
      { label: "Read", href: articlePath(title, undefined, lang), selected: view === "read" },
      { label: "View on Wikipedia", href: wikipediaUrl(title, lang), external: true, testId: "source-link" },
      { label: "View history", href: historyPath(title, lang), selected: view === "history", testId: "history-link" },
    ],
  };
}

/**
 * The infobox: Wikipedia's right-floated summary table, with the lead image,
 * the short description as its caption, and the facts parsed from the
 * article's own infobox.
 */
export function Infobox({
  title,
  rows,
  image,
  description,
}: {
  title: string;
  rows: InfoboxRow[];
  image?: WikiImage;
  description?: string;
}) {
  if (rows.length === 0 && !image) return null;
  return (
    <div className={styles.infobox}>
    <table className={styles.infoboxTable}>
      <caption className={styles.infoboxTitle}>{title}</caption>
      <tbody>
        {image ? (
          <tr>
            <td colSpan={2} className={styles.infoboxImage}>
              {/* Wikimedia serves pre-sized thumbnails with their own srcset. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.src} srcSet={image.srcSet} sizes="250px" width={image.width} height={image.height} alt={image.alt} decoding="async" />
              {description ? <div className={styles.infoboxCaption}>{description}</div> : null}
            </td>
          </tr>
        ) : null}
        {rows.map((row, i) => (
          <tr key={i}>
            <th scope="row" className={styles.infoboxLabel}>
              {row.label}
            </th>
            <td className={styles.infoboxData}>
              <InlineContent nodes={row.value} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

/** Text this short summarises itself. */
const MIN_SECTION_WORDS_FOR_SUMMARY = 120;

function sectionWords(blocks: Block[]): number {
  let words = 0;
  for (const block of blocks) {
    if (block.k === "p") words += inlineText(block.c).split(/\s+/).length;
    else if (block.k === "list") words += block.items.reduce((n, item) => n + inlineText(item.c).split(/\s+/).length, 0);
  }
  return words;
}

function SectionView({ section, summary }: { section: Section; summary?: { title: string; lang: string } }) {
  const offerSummary = summary && section.kind === "content" && sectionWords(section.blocks) >= MIN_SECTION_WORDS_FOR_SUMMARY;
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-h`}
      className={`${styles.section} ${section.kind !== "content" ? styles.appendix : ""}`}
      data-testid="article-section"
      data-no-terms={section.kind !== "content" ? "" : undefined}
    >
      <div className={styles.sectionHead}>
        <h2 id={`${section.id}-h`} className={`${styles.h2} ${offerSummary ? styles.h2WithTool : ""}`}>
          {section.title}
        </h2>
        {offerSummary ? <SectionSummary title={summary.title} lang={summary.lang} sectionId={section.id} sectionTitle={section.title} /> : null}
      </div>
      <Blocks blocks={section.blocks} />
    </section>
  );
}

export function ArticleSections({ doc, aiEnabled }: { doc: ArticleDocument; aiEnabled: boolean }) {
  const summary = aiEnabled ? { title: doc.title, lang: doc.lang ?? DEFAULT_LANGUAGE } : undefined;
  return (
    <>
      {doc.sections.map((s) => (
        <SectionView key={s.id} section={s} summary={summary} />
      ))}
    </>
  );
}

/** "Page information" for the tools column: Wikipedia metadata about this article. */
export function PageInformation({ meta }: { meta: PageMeta }) {
  const group = GROUPS.find((g) => g.id === classifyGroup(meta));
  const date = sourcedDate(meta.categories);
  const edited = formatDate(meta.lastEdited);
  const quality = meta.assessment ? ASSESSMENT_LABELS[meta.assessment] : undefined;
  return (
    <Portlet id="tools-page-info" heading="This article">
      <dl className={styles.pageInfo}>
        <div>
          <dt>Reading time</dt>
          <dd>{readingMinutes(meta)} min</dd>
        </div>
        {group ? (
          <div>
            <dt>Topic</dt>
            <dd>
              <Link href={`/topics/${group.id}`}>{group.label}</Link>
            </dd>
          </div>
        ) : null}
        {quality ? (
          <div>
            <dt>Quality</dt>
            <dd>{quality}</dd>
          </div>
        ) : null}
        {date ? (
          <div>
            <dt>{date.label}</dt>
            <dd title={`From Wikipedia category “${date.sourceCategory}”`}>{date.year}</dd>
          </div>
        ) : null}
        {meta.recentViews !== null ? (
          <div>
            <dt>Views</dt>
            <dd>
              {formatCount(meta.recentViews)} in {PAGEVIEW_DAYS} days
            </dd>
          </div>
        ) : null}
        {edited ? (
          <div>
            <dt>Last edited</dt>
            <dd>{edited}</dd>
          </div>
        ) : null}
      </dl>
    </Portlet>
  );
}

/** The article's tools column: Wikipedia's tools plus Wikihole's key concepts. */
export function ArticleTools({ meta, doc, concepts }: { meta: PageMeta; doc: ArticleDocument | null; concepts: React.ReactNode }) {
  const links = wikipediaLinks(meta.title, meta.lang);
  return (
    <div className={layout.tools}>
      <Portlet
        id="tools-general"
        heading="General"
        items={[
          { href: links.whatLinksHere, label: "What links here", external: true },
          { href: links.info, label: "Page information", external: true },
          ...(doc ? [{ href: links.revision(doc.revId), label: "Permanent link", external: true, title: `Revision ${doc.revId}` }] : []),
          { href: "#recent-changes", label: "Recent changes" },
          { href: "#rabbit-hole", label: "Related articles" },
          { href: "/random", label: "Random discovery" },
        ]}
      />
      <PageInformation meta={meta} />
      {concepts}
      <Portlet id="tools-print" heading="Print/export">
        <ul className={layout.portletList}>
          <li>
            <PrintLink />
          </li>
        </ul>
      </Portlet>
      <Portlet
        id="tools-projects"
        heading="In other projects"
        items={[
          { href: `https://${links.domain}/`, label: "Wikipedia", external: true },
          ...(meta.wikidataId ? [{ href: `https://www.wikidata.org/wiki/${meta.wikidataId}`, label: "Wikidata item", external: true }] : []),
        ]}
      />
    </div>
  );
}

/** Key concepts: the articles this one links to most. A real heading, since it is content. */
export function KeyConcepts({ doc }: { doc: ArticleDocument }) {
  const concepts = keyConcepts(doc, 10);
  if (concepts.length === 0) return null;
  return (
    <Portlet id="tools-concepts" heading="Key concepts" headingTag="h2">
      <ul className={styles.concepts}>
        {concepts.map((c) => (
          <li key={c.title}>
            <Link href={articlePath(c.title, undefined, doc.lang)} prefetch={false} data-wiki-link>
              {c.title}
            </Link>
            <span className={styles.conceptCount} title="Times linked in this article">
              {c.mentions}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.toolsNote}>The articles this one links to most, weighted towards the introduction.</p>
    </Portlet>
  );
}

/**
 * Terminology and equations, gathered from the article into a navbox: the
 * collapsible box Wikipedia puts at the foot of an article.
 */
export function StudyNavbox({ doc }: { doc: ArticleDocument }) {
  const terms = terminology(doc, 10);
  const eqs = equations(doc, 6);
  if (terms.length === 0 && eqs.length === 0) return null;
  return (
    <details className={styles.navbox} open data-no-terms>
      <summary className={styles.navboxTitle}>
        <span className={styles.navboxToggle} aria-hidden="true" />
        <span>Study aids for {doc.title}</span>
      </summary>
      <div className={styles.navboxScroll}>
      <table className={styles.navboxTable}>
        <tbody>
          {terms.length ? (
            <tr>
              <th scope="row" className={styles.navboxGroup}>
                <h2 className={styles.navboxGroupHeading}>Terminology</h2>
              </th>
              <td className={styles.navboxList}>
                <dl className={styles.terms}>
                  {terms.map((t) => (
                    <div key={t.term}>
                      <dt>{t.sectionId ? <a href={`#${t.sectionId}`}>{t.term}</a> : t.term}</dt>
                      <dd>{t.context}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.toolsNote}>Terms the article defines in bold, quoted in context.</p>
              </td>
            </tr>
          ) : null}
          {eqs.length ? (
            <tr>
              <th scope="row" className={styles.navboxGroup}>
                <h2 className={styles.navboxGroupHeading}>Equations ({doc.stats.equations})</h2>
              </th>
              <td className={styles.navboxList}>
                <ul className={styles.equations}>
                  {eqs.map((e, i) => (
                    <li key={i}>
                      <MathView html={e.html} tex={e.tex} display={false} />
                      {e.sectionId ? (
                        <a href={`#${e.sectionId}`} className={styles.equationSource}>
                          {e.sectionTitle}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </details>
  );
}

/** The categories box at the foot of every Wikipedia article. */
export function Catlinks({ doc }: { doc: ArticleDocument }) {
  if (doc.categories.length === 0) return null;
  const links = wikipediaLinks(doc.title, doc.lang);
  return (
    <div className={styles.catlinks}>
      <a href={`https://${links.domain}/wiki/Help:Category`} target="_blank" rel="noopener noreferrer">
        Categories
      </a>
      :{" "}
      <ul>
        {doc.categories.map((c) => (
          <li key={c}>
            <a href={links.category(c)} target="_blank" rel="noopener noreferrer">
              {c}
            </a>
          </li>
        ))}
      </ul>
      <p className={styles.catlinksSource}>
        {doc.stats.words.toLocaleString("en-US")} words · {doc.stats.references} references · revision{" "}
        <a href={links.revision(doc.revId)} target="_blank" rel="noopener noreferrer">
          {doc.revId}
        </a>{" "}
        ·{" "}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="license noopener noreferrer">
          CC BY-SA 4.0
        </a>
      </p>
    </div>
  );
}

export function SectionsSkeleton() {
  return (
    <div aria-hidden="true" className={styles.section}>
      <div className="skeleton" style={{ width: 220, height: 24, margin: "24px 0 16px" }} />
      {[96, 100, 92, 98, 70].map((w, i) => (
        <div key={i} className="skeleton" style={{ width: `${w}%`, height: 14, marginBottom: 12 }} />
      ))}
      <p className="label" style={{ marginTop: 16 }}>
        Loading the rest of the article…
      </p>
    </div>
  );
}
