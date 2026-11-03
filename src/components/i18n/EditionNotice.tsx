"use client";

import { DEFAULT_LANGUAGE, languageLocale } from "@/lib/i18n/languages";
import { useLanguage } from "./LanguageProvider";
import styles from "./i18n.module.css";

/**
 * Shown on features built from English Wikipedia's category taxonomy
 * (Discover, Topics, Random) when another edition is active, so the switch
 * back to English articles is never silent.
 */
export function EditionNotice({ feature }: { feature: string }) {
  const { lang, language, setLang } = useLanguage();
  if (lang === DEFAULT_LANGUAGE) return null;
  return (
    <p className={styles.notice} role="note" data-testid="edition-notice">
      {feature} is curated from English Wikipedia&rsquo;s categories, so its articles are in English. Search and the
      reader use <span lang={languageLocale(language)}>{language.nativeName}</span> Wikipedia.{" "}
      <button type="button" className={styles.noticeAction} onClick={() => setLang(DEFAULT_LANGUAGE)}>
        Switch to English
      </button>
    </p>
  );
}
