"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, fetchSuggestions } from "@/lib/api-client";
import { getLanguage, languageLocale } from "@/lib/i18n/languages";
import { articlePath, searchPath } from "@/lib/wikipedia/titles";
import type { SearchSuggestion } from "@/lib/wikipedia/types";
import { SearchLanguageSelect } from "@/components/i18n/SearchLanguageSelect";
import { useLanguage } from "@/components/i18n/LanguageProvider";
import { Icon } from "@/components/ui/Icon";
import styles from "./search.module.css";

const DEBOUNCE_MS = 180;
const MIN_CHARS = 2;
const memo = new Map<string, SearchSuggestion[]>();

/** Id of the header search field ("/" focuses it). */
export const SITE_SEARCH_ID = "site-search";

type Status = "idle" | "loading" | "done" | "error";
type Variant = "header" | "hero" | "dialog" | "portal";

interface Props {
  /**
   * "header": the site-wide field with an attached Search button.
   * "hero": the large field on the search and not-found pages.
   * "dialog": the full-width field in the mobile search overlay.
   * "portal": the homepage languages field, with the edition selector inside it.
   */
  variant?: Variant;
  autoFocus?: boolean;
  /** Called after navigating to a result (e.g. to close the dialog). */
  onNavigate?: () => void;
  /** Called when Escape is pressed with no open results. */
  onEscape?: () => void;
  initialQuery?: string;
  /** Fixed id for the input, so other controls can focus it. */
  inputId?: string;
  /** Search this edition instead of the reader's active one (e.g. a shared results link). */
  lang?: string;
}

const VARIANT_CLASS: Record<Variant, string> = {
  header: styles.headerBox,
  hero: styles.heroBox,
  dialog: styles.dialogBox,
  portal: styles.portalBox,
};

/** Bolds the part of a title that matches what was typed, as Wikipedia's typeahead does. */
function Highlighted({ title, query }: { title: string; query: string }) {
  const at = title.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0 || !query) return <>{title}</>;
  return (
    <>
      {title.slice(0, at)}
      <strong>{title.slice(at, at + query.length)}</strong>
      {title.slice(at + query.length)}
    </>
  );
}

export function SearchBox({ variant = "hero", autoFocus, onNavigate, onEscape, initialQuery = "", inputId, lang: langOverride }: Props) {
  const router = useRouter();
  const activeLanguage = useLanguage();
  const lang = langOverride ?? activeLanguage.lang;
  const language = getLanguage(lang);
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const listId = `${id}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchSuggestion[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_CHARS) return;
    const key = `${lang}|${trimmed.toLowerCase()}`;
    const cached = memo.get(key);
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        if (cached) {
          setResults(cached);
          setStatus("done");
          return;
        }
        setStatus("loading");
        try {
          const { results: found } = await fetchSuggestions(trimmed, lang, controller.signal);
          if (memo.size > 200) memo.clear();
          memo.set(key, found);
          setResults(found);
          setStatus("done");
          setError(null);
        } catch (err) {
          if (controller.signal.aborted) return;
          setStatus("error");
          setError(err instanceof ApiError ? err.message : "Search failed.");
        }
      },
      cached ? 0 : DEBOUNCE_MS,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed, lang]);

  const showResults = open && trimmed.length >= MIN_CHARS;
  // The final option always offers the full results page.
  const optionCount = showResults ? results.length + 1 : 0;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
    onNavigate?.();
  };

  const choose = (index: number) => {
    if (index >= 0 && index < results.length) go(articlePath(results[index].title, undefined, lang));
    else if (trimmed) go(searchPath(trimmed, lang));
    // An empty search goes nowhere; keep the reader in the field.
    else inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        if (!optionCount) return;
        event.preventDefault();
        setOpen(true);
        setActive((i) => (i + 1) % optionCount);
        break;
      case "ArrowUp":
        if (!optionCount) return;
        event.preventDefault();
        setActive((i) => (i <= 0 ? optionCount - 1 : i - 1));
        break;
      case "Enter":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        if (showResults) {
          event.preventDefault();
          setOpen(false);
          setActive(-1);
        } else {
          onEscape?.();
        }
        break;
    }
  };

  const optionId = (i: number) => `${id}-opt-${i}`;
  // The header field is generic like Wikipedia's; the others name the edition they search.
  const label = variant === "header" ? "Search Wikipedia" : `Search ${language.englishName} Wikipedia`;
  const locale = languageLocale(language);

  return (
    <div className={`${styles.box} ${VARIANT_CLASS[variant]}`} data-trail-ignore>
      <form
        role="search"
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          choose(active);
        }}
      >
        <label htmlFor={`${id}-input`} className="visually-hidden">
          {label}
        </label>
        <div className={styles.field}>
          {variant === "portal" ? null : <Icon name="search" size={variant === "hero" ? 20 : 18} className={styles.fieldIcon} />}
          <input
            ref={inputRef}
            id={`${id}-input`}
            className={styles.input}
            type="search"
            role="combobox"
            aria-expanded={showResults}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showResults && active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder={variant === "portal" ? undefined : "Search Wikipedia"}
            lang={variant === "portal" ? locale : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            maxLength={200}
          />
          {status === "loading" && showResults ? <span className={styles.spinner} aria-hidden="true" /> : null}
          {variant === "portal" ? <SearchLanguageSelect /> : null}
        </div>
        {variant === "portal" ? (
          <button type="submit" className={styles.portalSubmit} aria-label={label}>
            <Icon name="search" size={20} />
          </button>
        ) : variant === "dialog" ? null : (
          <button type="submit" className={styles.submit}>
            Search
          </button>
        )}
      </form>

      <div className="visually-hidden" aria-live="polite">
        {showResults && status === "done" ? `${results.length} results` : ""}
      </div>

      {showResults ? (
        <ul id={listId} role="listbox" aria-label="Search results" className={styles.results}>
          {status === "error" ? (
            <li className={styles.message} role="presentation">
              {error}
            </li>
          ) : null}
          {status === "done" && results.length === 0 ? (
            <li className={styles.message} role="presentation">
              No articles match &ldquo;{trimmed}&rdquo;.
            </li>
          ) : null}
          {results.map((r, i) => (
            <li
              key={r.pageId}
              id={optionId(i)}
              role="option"
              aria-selected={active === i}
              className={styles.option}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span className={styles.optionThumb} aria-hidden="true">
                {r.thumbnail ? (
                  // Wikimedia serves the sized thumbnail directly.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumbnail.src} alt="" width={40} height={40} loading="lazy" decoding="async" />
                ) : (
                  <Icon name="article" size={20} />
                )}
              </span>
              <span className={styles.optionText}>
                <span className={styles.optionTitle} lang={locale}>
                  <Highlighted title={r.title} query={trimmed} />
                </span>
                {r.description ? <span className={styles.optionDesc}>{r.description}</span> : null}
                {r.disambiguation ? <span className={styles.optionDesc}>Disambiguation</span> : null}
              </span>
            </li>
          ))}
          <li
            id={optionId(results.length)}
            role="option"
            aria-selected={active === results.length}
            className={`${styles.option} ${styles.all}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(results.length)}
            onClick={() => choose(results.length)}
          >
            <span className={styles.optionThumb} aria-hidden="true">
              <Icon name="search" size={20} />
            </span>
            <span className={styles.optionText}>
              <span>
                Search for pages containing <strong>{trimmed}</strong>
              </span>
            </span>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
