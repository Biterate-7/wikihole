"use client";

import { allLanguages, languageAbbreviation } from "@/lib/i18n/languages";
import { Icon } from "@/components/ui/Icon";
import { useLanguage } from "./LanguageProvider";
import styles from "./i18n.module.css";

/**
 * Edition picker. In the header it is Wikipedia's "文A" language button; in
 * the portal search field it is a compact "EN ▾". A native <select> sits
 * transparently over the label, so keyboard, screen reader and mobile
 * behaviour are the platform's own; options list each edition by its native name.
 */
export function SearchLanguageSelect({ variant = "search" }: { variant?: "search" | "header" }) {
  const { lang, language, setLang } = useLanguage();
  const header = variant === "header";
  return (
    <span className={`${styles.select} ${header ? styles.selectHeader : styles.selectSearch}`}>
      {header ? <Icon name="language" size={18} className={styles.selectIcon} /> : null}
      <span className={styles.selectCode} aria-hidden="true">
        {header ? <span className={styles.selectName}>{language.englishName}</span> : null}
        <span className={header ? styles.selectAbbr : undefined}>{languageAbbreviation(lang)}</span>
      </span>
      <svg className={styles.selectChevron} width="10" height="10" viewBox="0 0 20 20" aria-hidden="true">
        <path fill="currentColor" d="m17.5 4.75-7.5 7.5-7.5-7.5L1 6.25l9 9 9-9z" />
      </svg>
      <select
        className={styles.selectNative}
        value={lang}
        onChange={(event) => setLang(event.target.value)}
        aria-label={`Wikipedia language: ${language.englishName}`}
        title={`${language.nativeName} · ${language.englishName} Wikipedia`}
        data-testid={header ? "header-language" : "search-language"}
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
