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

type Status = "idle" | "loading" | "done" | "error";

interface Props {
  /** "portal" is the homepage field: language selector inside, search button attached. */
  variant?: "hero" | "dialog" | "portal";
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

  return (
    <div
      className={`${styles.box} ${variant === "dialog" ? styles.dialogBox : variant === "portal" ? styles.portalBox : styles.heroBox}`}
      data-trail-ignore
    >
      <form
        role="search"
        className={variant === "portal" ? styles.portalForm : styles.field}
        onSubmit={(e) => {
          e.preventDefault();
          choose(active);
        }}
      >
        {variant === "portal" ? null : <Icon name="search" size={15} className={styles.fieldIcon} />}
        <label htmlFor={`${id}-input`} className="visually-hidden">
          Search {language.englishName} Wikipedia
        </label>
        <div className={variant === "portal" ? styles.portalField : styles.fieldInner}>
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
            placeholder={variant === "portal" ? undefined : `Search ${language.englishName} Wikipedia: halting problem, Ramsey theory, ephaptic coupling…`}
            lang={variant === "portal" ? languageLocale(language) : undefined}
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
          {variant === "hero" ? <kbd className={styles.kbd} aria-hidden="true">/</kbd> : null}
          {variant === "portal" ? <SearchLanguageSelect /> : null}
        </div>
        {variant === "portal" ? (
          <button type="submit" className={styles.portalSubmit} aria-label={`Search ${language.englishName} Wikipedia`}>
            <Icon name="search" size={20} />
          </button>
        ) : null}
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
              <span className={styles.optionTitle} lang={languageLocale(language)}>
                {r.title}
              </span>
              {r.description ? <span className={styles.optionDesc}>{r.description}</span> : null}
              {r.disambiguation ? <span className="label">Disambiguation</span> : null}
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
            <span className="label">All results for &ldquo;{trimmed}&rdquo;</span>
            <Icon name="arrow-right" size={12} />
          </li>
        </ul>
      ) : null}
    </div>
  );
}
