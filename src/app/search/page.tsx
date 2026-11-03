import type { Metadata } from "next";
import Link from "next/link";
import { SearchBox } from "@/components/search/SearchBox";
import { StateMessage } from "@/components/ui/StateMessage";
import { formatCount } from "@/lib/format";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { getLanguage, isSupportedLanguage, languageLocale } from "@/lib/i18n/languages";
import { requestLanguage } from "@/lib/i18n/server";
import { describeError } from "@/lib/server/http";
import { fullSearch } from "@/lib/wikipedia/api";
import { articlePath, searchPath } from "@/lib/wikipedia/titles";
import type { FullSearchResult } from "@/lib/wikipedia/types";
import styles from "../pages.module.css";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = (await searchParams).q;
  return { title: typeof q === "string" && q.trim() ? `Search: ${q.trim().slice(0, 80)}` : "Search", robots: { index: false } };
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  // An explicit ?lang= wins (shared links); otherwise the reader's chosen edition.
  const chosen = await requestLanguage();
  const lang = isSupportedLanguage(params.lang) ? params.lang : chosen;
  const language = getLanguage(lang);
  const locale = languageLocale(language);
  const page = (offsetValue: number) => `${searchPath(q, lang)}&offset=${offsetValue}`;
  const offset = Math.min(Math.max(Number.parseInt(typeof params.offset === "string" ? params.offset : "0", 10) || 0, 0), 9980);

  let result: FullSearchResult | null = null;
  let error: string | null = null;
  if (q) {
    try {
      result = await fullSearch(q, offset, 20, lang);
    } catch (err) {
      error = describeError(err).message;
    }
  }

  return (
    <LanguageProvider initialLang={chosen}>
      <div className={`container ${styles.narrow}`}>
        <header className={styles.pageHead}>
          <p className="label">Search Wikipedia</p>
          <h1 className={styles.pageTitle}>{q ? <>Results for &ldquo;{q}&rdquo;</> : "Search"}</h1>
          {result ? (
            <p className={styles.pageSub}>
              {formatCount(result.total)} articles on {language.englishName} Wikipedia
              {result.total > 0 ? ` · showing ${offset + 1}–${offset + result.hits.length}` : ""}
            </p>
          ) : null}
          <div className={styles.searchBar} data-hero-search>
            <SearchBox variant="hero" initialQuery={q} key={`${lang}:${q}`} lang={lang} />
          </div>
          {result?.suggestion ? (
            <p className={styles.suggest}>
              Did you mean{" "}
              <Link href={searchPath(result.suggestion, lang)} lang={locale}>
                {result.suggestion}
              </Link>
              ?
            </p>
          ) : null}
        </header>

        {error ? (
          <StateMessage
            kind="error"
            title="Search is unavailable right now."
            action={
              <Link className="btn" href={page(offset)}>
                Try again
              </Link>
            }
          >
            {error}
          </StateMessage>
        ) : null}

        {result && result.hits.length === 0 ? (
          <StateMessage kind="empty" title={`No Wikipedia articles match “${q}”.`}>
            Try fewer or different words, or check the spelling.
          </StateMessage>
        ) : null}

        {result && result.hits.length > 0 ? (
          <>
            <ol className={styles.results} start={offset + 1} data-testid="search-results" lang={locale} dir={language.dir}>
              {result.hits.map((hit) => (
                <li key={hit.pageId} className={styles.result}>
                  <h2 className={styles.resultTitle}>
                    <Link href={articlePath(hit.title, undefined, lang)}>{hit.title}</Link>
                  </h2>
                  {hit.description ? <p className={styles.resultDesc}>{hit.description}</p> : null}
                  {hit.snippet?.length ? (
                    <p className={styles.snippet}>
                      {hit.snippet.map((run, i) => (run.match ? <mark key={i}>{run.text}</mark> : <span key={i}>{run.text}</span>))}
                      &hellip;
                    </p>
                  ) : null}
                  <p className={`label ${styles.resultMeta}`}>
                    {Math.max(1, Math.round(hit.wordCount / 230))} min read
                    {hit.disambiguation ? <span className="dot">Disambiguation</span> : null}
                  </p>
                </li>
              ))}
            </ol>
            <nav className={styles.pager} aria-label="Search pages">
              {offset > 0 ? (
                <Link className="btn" href={page(Math.max(0, offset - 20))}>
                  Previous
                </Link>
              ) : (
                <span />
              )}
              {result.nextOffset !== undefined ? (
                <Link className="btn" href={page(result.nextOffset)}>
                  Next
                </Link>
              ) : null}
            </nav>
          </>
        ) : null}
      </div>
    </LanguageProvider>
  );
}
