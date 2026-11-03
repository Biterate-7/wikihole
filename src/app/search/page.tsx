import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import { SearchBox } from "@/components/search/SearchBox";
import { StateMessage } from "@/components/ui/StateMessage";
import { ThumbImage } from "@/components/ui/ThumbImage";
import { formatCount, formatDate } from "@/lib/format";
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

/** Special:Search: the large search form, the result count, then compact article results. */
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
      <PageShell
        title={q ? "Search results" : "Search"}
        tabs={{
          left: [{ label: "Special page", href: q ? searchPath(q, lang) : "/search", selected: true }],
        }}
        tools={<SiteTools />}
      >
        <div className={styles.searchForm}>
          <SearchBox variant="hero" initialQuery={q} key={`${lang}:${q}`} lang={lang} />
        </div>
        {result?.suggestion ? (
          <p className={styles.suggest}>
            Did you mean:{" "}
            <Link href={searchPath(result.suggestion, lang)} lang={locale}>
              <b>
                <i>{result.suggestion}</i>
              </b>
            </Link>
          </p>
        ) : null}
        {result ? (
          <div className={styles.resultsInfo}>
            <span>
              {formatCount(result.total)} articles on {language.englishName} Wikipedia
            </span>
            {result.total > 0 ? (
              <span>
                Results {offset + 1} – {offset + result.hits.length} of {result.total.toLocaleString("en-US")}
              </span>
            ) : null}
          </div>
        ) : (
          <p className={styles.intro}>
            Search the titles and text of {language.englishName} Wikipedia. Suggestions appear as you type; press Enter
            for the full results.
          </p>
        )}

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
                  {hit.thumbnail ? (
                    <Link href={articlePath(hit.title, undefined, lang)} className={styles.resultThumb} tabIndex={-1} aria-hidden="true">
                      <ThumbImage thumbnail={hit.thumbnail} size={60} />
                    </Link>
                  ) : (
                    <span className={styles.resultNoThumb} aria-hidden="true" />
                  )}
                  <div className={styles.resultBody}>
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
                    <p className={styles.resultMeta}>
                      {Math.round(hit.size / 1024)} KB ({hit.wordCount.toLocaleString("en-US")} words) · {Math.max(1, Math.round(hit.wordCount / 230))} min read
                      {hit.timestamp ? ` · ${formatDate(hit.timestamp)}` : ""}
                      {hit.disambiguation ? " · Disambiguation" : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <nav className={styles.pager} aria-label="Search pages">
              View ({offset > 0 ? <Link href={page(Math.max(0, offset - 20))}>previous 20</Link> : "previous 20"} |{" "}
              {result.nextOffset !== undefined ? <Link href={page(result.nextOffset)}>next 20</Link> : "next 20"})
            </nav>
          </>
        ) : null}
      </PageShell>
    </LanguageProvider>
  );
}
