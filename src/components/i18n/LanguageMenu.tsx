"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchLanguageStats } from "@/lib/api-client";
import {
  DEFAULT_LANGUAGE,
  allLanguages,
  formatArticleCount,
  getLanguage,
  languageLocale,
  type WikiLanguage,
} from "@/lib/i18n/languages";
import { useLanguage } from "./LanguageProvider";
import styles from "./i18n.module.css";

type Counts = Record<string, number | null>;
type Status = "idle" | "loading" | "done" | "error";

/** Wikipedia groups editions by size; so does this list once live counts arrive. */
const TIERS = [
  { min: 1_000_000, label: "1,000,000+ articles" },
  { min: 100_000, label: "100,000+ articles" },
  { min: 10_000, label: "10,000+ articles" },
  { min: 0, label: "Fewer than 10,000 articles" },
];

function matches(language: WikiLanguage, needle: string): boolean {
  if (!needle) return true;
  return [language.nativeName, language.englishName, language.code].some((v) => v.toLowerCase().includes(needle));
}

/**
 * "Explore Wikihole in your language": a disclosure listing every supported
 * edition by native name, with live article counts, a filter, and a way back
 * to English. Escape closes it and returns focus to the toggle.
 */
export function LanguageMenu({ initialCounts = {} }: { initialCounts?: Counts }) {
  const { lang, language, setLang } = useLanguage();
  const panelId = useId();
  const toggleId = `${panelId}-toggle`;
  const filterRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [counts, setCounts] = useState<Counts>(initialCounts);
  const [status, setStatus] = useState<Status>("idle");

  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  // Counts for the remaining editions are fetched the first time the menu opens.
  const loadCounts = () => {
    if (status === "loading" || status === "done") return;
    const controller = new AbortController();
    request.current = controller;
    setStatus("loading");
    fetchLanguageStats(undefined, controller.signal)
      .then(({ languages }) => {
        setCounts((previous) => {
          const next = { ...previous };
          for (const entry of languages) if (entry.articles !== null || !(entry.code in next)) next[entry.code] = entry.articles;
          return next;
        });
        setStatus("done");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
  };

  const openMenu = () => {
    setOpen(true);
    loadCounts();
  };

  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setFilter("");
    document.getElementById(toggleId)?.focus();
  };

  const choose = (code: string) => {
    setLang(code);
    close();
  };

  const needle = filter.trim().toLowerCase();
  const groups = useMemo(() => {
    const visible = allLanguages().filter((l) => matches(l, needle));
    const known = visible.some((l) => typeof counts[l.code] === "number");
    if (!known) return [{ label: "All languages", items: visible }];
    const ordered = [...visible].sort((a, b) => (counts[b.code] ?? -1) - (counts[a.code] ?? -1));
    const tiered = TIERS.map((tier, i) => ({
      label: tier.label,
      items: ordered.filter((l) => {
        const n = counts[l.code];
        return typeof n === "number" && n >= tier.min && (i === 0 || n < TIERS[i - 1].min);
      }),
    }));
    const unknown = ordered.filter((l) => typeof counts[l.code] !== "number");
    return [...tiered, { label: "Article count unavailable", items: unknown }].filter((g) => g.items.length > 0);
  }, [counts, needle]);

  return (
    <div className={styles.menu} data-open={open || undefined}>
      <div className={styles.menuBar}>
        <span className={styles.menuRule} aria-hidden="true" />
        <button
          id={toggleId}
          type="button"
          className={styles.menuToggle}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => (open ? close() : openMenu())}
          data-testid="language-menu-toggle"
        >
          <svg className={styles.menuIcon} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M20 18h-1.44a.6.6 0 0 1-.4-.12.8.8 0 0 1-.23-.31L17 15h-5l-1 2.54a.8.8 0 0 1-.22.3.6.6 0 0 1-.4.14H9l4.55-11.47h1.89zm-3.53-4.31L14.89 9.5a12 12 0 0 1-.39-1.24q-.09.37-.19.69l-.19.56-1.58 4.19zm-6.3-1.58a13.4 13.4 0 0 1-2.91-1.41 11.46 11.46 0 0 0 2.81-5.37H12V4H7.31a4 4 0 0 0-.2-.56C6.87 2.79 6.6 2 6.6 2l-1.47.5s.4.89.6 1.5H0v1.33h2.15A11.23 11.23 0 0 0 5 10.7a17.2 17.2 0 0 1-5 2.1q.56.82.87 1.38a23.3 23.3 0 0 0 5.22-2.51 15.6 15.6 0 0 0 3.56 1.77zM3.63 5.33h4.91a8.1 8.1 0 0 1-2.45 4.45 9.1 9.1 0 0 1-2.46-4.45"
            />
          </svg>
          <span>Explore Wikihole in your language</span>
          <svg className={styles.menuChevron} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 4.25 6 8.25l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
        <span className={styles.menuRule} aria-hidden="true" />
      </div>

      {open ? (
        <div
          id={panelId}
          className={styles.panel}
          role="region"
          aria-label="Wikipedia languages"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <div className={styles.panelHead}>
            <label className="visually-hidden" htmlFor={`${panelId}-filter`}>
              Find a language
            </label>
            <input
              ref={filterRef}
              id={`${panelId}-filter`}
              className={styles.panelFilter}
              type="search"
              placeholder="Find a language"
              autoComplete="off"
              spellCheck={false}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <p className={styles.panelCurrent}>
              Reading <span lang={languageLocale(language)}>{language.nativeName}</span> Wikipedia
              {lang !== DEFAULT_LANGUAGE ? (
                <>
                  {" · "}
                  <button type="button" className={styles.panelReset} onClick={() => choose(DEFAULT_LANGUAGE)}>
                    Return to English
                  </button>
                </>
              ) : null}
            </p>
          </div>

          <div className={styles.panelStatus} aria-live="polite">
            {status === "loading" ? "Loading article counts from Wikipedia…" : null}
            {status === "error" ? "Article counts are unavailable right now. Every language can still be selected." : null}
          </div>

          {groups.length === 0 ? (
            <p className={styles.panelEmpty}>No language matches &ldquo;{filter.trim()}&rdquo;.</p>
          ) : (
            groups.map((group) => (
              <section key={group.label} className={styles.group} aria-label={group.label}>
                <h3 className={styles.groupTitle}>{group.label}</h3>
                <ul className={styles.groupList}>
                  {group.items.map((l) => {
                    const count = counts[l.code];
                    const selected = l.code === lang;
                    return (
                      <li key={l.code}>
                        <button
                          type="button"
                          className={styles.option}
                          aria-pressed={selected}
                          onClick={() => choose(l.code)}
                          title={typeof count === "number" ? formatArticleCount(count, getLanguage(l.code)) : undefined}
                          data-lang={l.code}
                        >
                          <span lang={languageLocale(l)} dir={l.dir} className={styles.optionNative}>
                            {l.nativeName}
                          </span>
                          {l.nativeName !== l.englishName ? <span className={styles.optionEnglish}>{l.englishName}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
