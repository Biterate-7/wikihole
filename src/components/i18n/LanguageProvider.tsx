"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, getLanguage, isSupportedLanguage, type WikiLanguage } from "@/lib/i18n/languages";

/**
 * The reader's active Wikipedia edition: used by search, the homepage and
 * the language selectors. It lives in a cookie so it persists between
 * visits, and is read in the browser so static pages stay static.
 *
 * Pages that render on demand can read the cookie on the server and wrap
 * their content in <LanguageProvider initialLang>, so the first paint already
 * shows the right edition; elsewhere the edition applies on hydration.
 */

const ServerLanguageContext = createContext<string>(DEFAULT_LANGUAGE);

const ONE_YEAR_S = 60 * 60 * 24 * 365;
const listeners = new Set<() => void>();
/** Holds the choice for this page view when cookies cannot be written. */
let unpersisted: string | null = null;

function readCookie(): string | null {
  if (unpersisted) return unpersisted;
  try {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LANGUAGE_COOKIE}=([^;]*)`));
    const value = match ? decodeURIComponent(match[1]) : null;
    return isSupportedLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Makes `code` the active edition everywhere on the page and remembers it. */
export function setActiveLanguage(code: string): void {
  if (!isSupportedLanguage(code)) return;
  try {
    document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;
  } catch {
    // Cookies unavailable: fall through to the in-memory choice below.
  }
  unpersisted = null;
  if (readCookie() !== code) unpersisted = code;
  listeners.forEach((listener) => listener());
}

export function LanguageProvider({ initialLang, children }: { initialLang: string; children: React.ReactNode }) {
  const value = isSupportedLanguage(initialLang) ? initialLang : DEFAULT_LANGUAGE;
  return <ServerLanguageContext.Provider value={value}>{children}</ServerLanguageContext.Provider>;
}

export function useLanguage(): { lang: string; language: WikiLanguage; setLang: (code: string) => void } {
  const serverLang = useContext(ServerLanguageContext);
  // During server rendering and hydration this is null, so both sides agree on `serverLang`.
  const chosen = useSyncExternalStore(subscribe, readCookie, () => null);
  const lang = chosen ?? serverLang;
  return { lang, language: getLanguage(lang), setLang: setActiveLanguage };
}
