"use client";

import { allLanguages, languageAbbreviation } from "@/lib/i18n/languages";
import { useLanguage } from "./LanguageProvider";
import styles from "./i18n.module.css";

/**
 * Compact edition picker ("EN ▾"). A native <select> sits transparently over
 * the abbreviation, so keyboard, screen reader and mobile behaviour are the
 * platform's own; options list each edition by its native name.
 */
export function SearchLanguageSelect({ variant = "search" }: { variant?: "search" | "header" }) {
  const { lang, language, setLang } = useLanguage();
  return (
    <span className={`${styles.select} ${variant === "header" ? styles.selectHeader : styles.selectSearch}`}>
      <span className={styles.selectCode} aria-hidden="true">
        {languageAbbreviation(lang)}
      </span>
      <svg className={styles.selectChevron} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <select
        className={styles.selectNative}
        value={lang}
        onChange={(event) => setLang(event.target.value)}
        aria-label={`Wikipedia language: ${language.englishName}`}
        title={`${language.nativeName} · ${language.englishName} Wikipedia`}
        data-testid={variant === "header" ? "header-language" : "search-language"}
      >
        {allLanguages().map((l) => (
          <option key={l.code} value={l.code} lang={l.locale ?? l.code}>
            {l.nativeName}
            {l.nativeName !== l.englishName ? ` (${l.englishName})` : ""}
          </option>
        ))}
      </select>
    </span>
  );
}
