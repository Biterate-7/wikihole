"use client";

import { useLanguage } from "@/components/i18n/LanguageProvider";
import { FEATURED_LANGUAGES, getLanguage, languageLocale } from "@/lib/i18n/languages";
import { PuzzleGlobe } from "./globe/PuzzleGlobe";
import styles from "./home.module.css";

/**
 * Horizontal distance (px, at desktop scale) of each row's entries from the
 * globe's centre, top to bottom. The rows follow the globe's curve.
 */
const ROW_OFFSETS = [133, 187, 198, 187, 133];

export const PORTAL_SEARCH_ID = "portal-search";

/**
 * The ten featured editions arranged around the globe: left column first,
 * then right, row by row. Choosing one makes it the active edition and moves
 * focus to the search field, ready to search that Wikipedia.
 */
export function LanguageRing({ counts }: { counts: Record<string, string | undefined> }) {
  const { lang, setLang } = useLanguage();

  const choose = (code: string) => {
    setLang(code);
    document.getElementById(`${PORTAL_SEARCH_ID}-input`)?.focus();
  };

  return (
    <div className={styles.central}>
      {/* Decorative: the wordmark above names the site. */}
      <PuzzleGlobe className={styles.globe} />
      <ul className={styles.ring} aria-label="Featured Wikipedia languages">
        {FEATURED_LANGUAGES.map((code, index) => {
          const language = getLanguage(code);
          const row = Math.floor(index / 2);
          const side = index % 2 === 0 ? -1 : 1;
          const style = { "--row": row, "--dx": `${side * ROW_OFFSETS[row]}px` } as React.CSSProperties;
          return (
            <li key={code} className={styles.lang} style={style} data-testid="featured-language" data-lang={code}>
              <button
                type="button"
                className={styles.langButton}
                aria-pressed={code === lang}
                title={`${language.englishName} Wikipedia`}
                onClick={() => choose(code)}
              >
                <strong className={styles.langName} lang={languageLocale(language)}>
                  {language.nativeName}
                </strong>
                <small className={styles.langCount} lang={languageLocale(language)}>
                  {counts[code] ?? " "}
                </small>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
