import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { SaveButton } from "@/components/ui/SaveButton";
import { equations, keyConcepts, terminology } from "@/lib/content/concepts";
import type { ArticleDocument, InfoboxRow, Section } from "@/lib/content/types";
import { classifyGroup, readingMinutes, sourcedDate, topCategories } from "@/lib/discovery/score";
import { GROUPS } from "@/lib/discovery/topics";
import { ASSESSMENT_LABELS, assessmentBadge, formatCount, formatDate, leadSentences } from "@/lib/format";
import { DEFAULT_LANGUAGE, wikipediaDomain } from "@/lib/i18n/languages";
import { articlePath, wikipediaUrl } from "@/lib/wikipedia/titles";
import { PAGEVIEW_DAYS, type PageMeta } from "@/lib/wikipedia/types";
import { Blocks } from "./Blocks";
import { InlineContent, MathView } from "./Inline";
import styles from "./article.module.css";

export function ArticleHeader({ meta, displayTitle }: { meta: PageMeta; displayTitle: string }) {
  const groupId = classifyGroup(meta);
  const group = GROUPS.find((g) => g.id === groupId);
  const date = sourcedDate(meta.categories);
  const badge = assessmentBadge(meta.assessment);
  const edited = formatDate(meta.lastEdited);
  const minutes = readingMinutes(meta);

  return (
    <header className={styles.header}>
      <p className="label">
        {group ? (
          <Link href={`/topics/${group.id}`} className={styles.kickerLink}>
            {group.label}
          </Link>
        ) : (
          "Wikipedia article"
        )}
        {topCategories(meta.categories, 1).map((c) => (
          <span key={c} className="dot">
            {c}
          </span>
        ))}
      </p>
      <h1 className={styles.title}>{displayTitle}</h1>
      {meta.description ? <p className={styles.subtitle}>{meta.description}</p> : null}
      <div className={styles.metaRow}>
        <span>{minutes} min read</span>
        {date ? (
          <span className="dot" title={`From Wikipedia category “${date.sourceCategory}”`}>
            {date.label} {date.year}
          </span>
        ) : null}
        {badge ? (
          <span className="dot" title={ASSESSMENT_LABELS[meta.assessment ?? "Other"]}>
            {ASSESSMENT_LABELS[meta.assessment ?? "Other"] ?? badge}
          </span>
        ) : null}
        {meta.recentViews !== null ? (
          <span className="dot">
            {formatCount(meta.recentViews)} views / {PAGEVIEW_DAYS} days
          </span>
        ) : null}
        {edited ? <span className="dot">Edited {edited}</span> : null}
      </div>
      <div className={styles.headerActions}>
        <SaveButton
          variant="button"
          article={{
            title: meta.title,
            description: meta.description,
            extract: meta.extract ? leadSentences(meta.extract, 300) : undefined,
            thumbnail: meta.thumbnail,
            readingMinutes: minutes,
            groupLabel: group?.label,
            ...(meta.lang ? { lang: meta.lang } : {}),
          }}
        />
        <a className="btn" href={wikipediaUrl(meta.title, meta.lang)} target="_blank" rel="noopener noreferrer" data-testid="source-link">
          Read on Wikipedia <Icon name="arrow-up-right" size={11} />
        </a>
        <a className="btn" href="#rabbit-hole">
          Rabbit hole <Icon name="corner-down-right" size={11} />
        </a>
      </div>
    </header>
  );
}

function SectionView({ section }: { section: Section }) {
  const compact = section.kind !== "content";
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-h`}
      className={`${styles.section} ${compact ? styles.compactSection : ""}`}
      data-testid="article-section"
    >
      <h2 id={`${section.id}-h`} className={styles.h2}>
        {section.title}
      </h2>
      <Blocks blocks={section.blocks} />
    </section>
  );
}

export function ArticleSections({ doc }: { doc: ArticleDocument }) {
  return (
    <>
      {doc.sections.map((s) => (
        <SectionView key={s.id} section={s} />
      ))}
    </>
  );
}

export function Facts({ rows }: { rows: InfoboxRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className={styles.asidePanel} aria-labelledby="facts-heading">
      <h2 id="facts-heading" className="label">
        At a glance
      </h2>
      <dl className={styles.facts}>
        {rows.map((row, i) => (
          <div key={i}>
            <dt>{row.label}</dt>
            <dd>
              <InlineContent nodes={row.value} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ArticleAside({ doc, meta }: { doc: ArticleDocument; meta: PageMeta }) {
  const concepts = keyConcepts(doc, 10);
  const terms = terminology(doc, 10);
  const eqs = equations(doc, 6);
  const categories = topCategories(doc.categories, 8);
  return (
    <>
      {concepts.length ? (
        <section className={styles.asidePanel} aria-labelledby="concepts-heading">
          <h2 id="concepts-heading" className="label">
            Key concepts
          </h2>
          <ul className={styles.concepts}>
            {concepts.map((c) => (
              <li key={c.title}>
                <Link href={articlePath(c.title, undefined, doc.lang)} prefetch={false} data-wiki-link>
                  {c.title}
                </Link>
                <span className="label" title="Times linked in this article">
                  {c.mentions}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.asideNote}>The articles this one links to most, weighted towards the introduction.</p>
        </section>
      ) : null}

      {terms.length ? (
        <section className={styles.asidePanel} aria-labelledby="terms-heading">
          <h2 id="terms-heading" className="label">
            Terminology
          </h2>
          <dl className={styles.terms}>
            {terms.map((t) => (
              <div key={t.term}>
                <dt>{t.sectionId ? <a href={`#${t.sectionId}`}>{t.term}</a> : t.term}</dt>
                <dd>{t.context}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.asideNote}>Terms the article defines in bold, quoted in context.</p>
        </section>
      ) : null}

      {eqs.length ? (
        <section className={styles.asidePanel} aria-labelledby="equations-heading">
          <h2 id="equations-heading" className="label">
            Equations · {doc.stats.equations}
          </h2>
          <ul className={styles.equations}>
            {eqs.map((e, i) => (
              <li key={i}>
                <MathView html={e.html} tex={e.tex} display={false} />
                {e.sectionId ? (
                  <a href={`#${e.sectionId}`} className="label">
                    {e.sectionTitle}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.asidePanel} aria-labelledby="source-heading">
        <h2 id="source-heading" className="label">
          Source
        </h2>
        <dl className={styles.facts}>
          <div>
            <dt>Article</dt>
            <dd>
              <a href={wikipediaUrl(doc.title, doc.lang)} target="_blank" rel="noopener noreferrer">
                {wikipediaDomain(doc.lang ?? DEFAULT_LANGUAGE)}
              </a>
            </dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>
              <a
                href={`https://${wikipediaDomain(doc.lang ?? DEFAULT_LANGUAGE)}/w/index.php?oldid=${doc.revId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {doc.revId}
              </a>
            </dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>
              {doc.stats.words.toLocaleString("en-US")} words · {doc.stats.references} references
            </dd>
          </div>
          {meta.wikidataId ? (
            <div>
              <dt>Wikidata</dt>
              <dd>
                <a href={`https://www.wikidata.org/wiki/${meta.wikidataId}`} target="_blank" rel="noopener noreferrer">
                  {meta.wikidataId}
                </a>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>License</dt>
            <dd>
              <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="license noopener noreferrer">
                CC BY-SA 4.0
              </a>
            </dd>
          </div>
        </dl>
        {categories.length ? (
          <p className={styles.categories}>
            {categories.map((c, i) => (
              <span key={c}>
                {i ? " · " : ""}
                {c}
              </span>
            ))}
          </p>
        ) : null}
      </section>
    </>
  );
}

export function SectionsSkeleton() {
  return (
    <div aria-hidden="true" className={styles.section}>
      <div className="skeleton" style={{ width: 220, height: 24, margin: "8px 0 20px" }} />
      {[96, 100, 92, 98, 70].map((w, i) => (
        <div key={i} className="skeleton" style={{ width: `${w}%`, height: 14, marginBottom: 12 }} />
      ))}
      <p className="label" style={{ marginTop: 16 }}>
        Loading the rest of the article…
      </p>
    </div>
  );
}

