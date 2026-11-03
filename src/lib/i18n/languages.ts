/**
 * Wikipedia language editions WikiHole can read and search. Shared by server
 * and client code.
 *
 * Adding a language is a single entry in LANGUAGES: every selector, the
 * search language menu, the reader routes (/<code>/wiki/<Title>) and the API
 * endpoints derive from it. Article counts are never stored here; they come
 * live from each edition's siteinfo statistics (see getSiteStatistics).
 */

export interface WikiLanguage {
  /** Wikipedia subdomain and route prefix, e.g. "ja" for ja.wikipedia.org. */
  code: string;
  /** Name in the language's own script, as Wikipedia lists it. */
  nativeName: string;
  englishName: string;
  dir: "ltr" | "rtl";
  /** BCP 47 tag for number formatting and the `lang` attribute, when it differs from `code`. */
  locale?: string;
  /** The word Wikipedia's own portal uses after the article count ("7,254,000+ articles"). */
  articlesLabel?: string;
}

const DEFINITIONS: WikiLanguage[] = [
  { code: "en", nativeName: "English", englishName: "English", dir: "ltr", articlesLabel: "articles" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese", dir: "ltr", articlesLabel: "記事" },
  { code: "de", nativeName: "Deutsch", englishName: "German", dir: "ltr", articlesLabel: "Artikel" },
  { code: "fr", nativeName: "Français", englishName: "French", dir: "ltr", articlesLabel: "articles" },
  { code: "ru", nativeName: "Русский", englishName: "Russian", dir: "ltr", articlesLabel: "статей" },
  { code: "es", nativeName: "Español", englishName: "Spanish", dir: "ltr", articlesLabel: "artículos" },
  { code: "it", nativeName: "Italiano", englishName: "Italian", dir: "ltr", articlesLabel: "voci" },
  { code: "zh", nativeName: "中文", englishName: "Chinese", dir: "ltr", articlesLabel: "条目 / 條目" },
  { code: "pt", nativeName: "Português", englishName: "Portuguese", dir: "ltr", articlesLabel: "artigos" },
  { code: "pl", nativeName: "Polski", englishName: "Polish", dir: "ltr", articlesLabel: "haseł" },
  { code: "nl", nativeName: "Nederlands", englishName: "Dutch", dir: "ltr", articlesLabel: "artikelen" },
  { code: "sv", nativeName: "Svenska", englishName: "Swedish", dir: "ltr", articlesLabel: "artiklar" },
  { code: "uk", nativeName: "Українська", englishName: "Ukrainian", dir: "ltr", articlesLabel: "статей" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic", dir: "rtl", articlesLabel: "مقالة" },
  { code: "vi", nativeName: "Tiếng Việt", englishName: "Vietnamese", dir: "ltr", articlesLabel: "bài viết" },
  { code: "fa", nativeName: "فارسی", englishName: "Persian", dir: "rtl", articlesLabel: "مقاله" },
  { code: "ca", nativeName: "Català", englishName: "Catalan", dir: "ltr", articlesLabel: "articles" },
  { code: "id", nativeName: "Bahasa Indonesia", englishName: "Indonesian", dir: "ltr", articlesLabel: "artikel" },
  { code: "ko", nativeName: "한국어", englishName: "Korean", dir: "ltr", articlesLabel: "문서" },
  { code: "no", nativeName: "Norsk (bokmål)", englishName: "Norwegian", dir: "ltr", locale: "nb", articlesLabel: "artikler" },
  { code: "fi", nativeName: "Suomi", englishName: "Finnish", dir: "ltr", articlesLabel: "artikkelia" },
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish", dir: "ltr", articlesLabel: "madde" },
  { code: "cs", nativeName: "Čeština", englishName: "Czech", dir: "ltr", articlesLabel: "článků" },
  { code: "hu", nativeName: "Magyar", englishName: "Hungarian", dir: "ltr", articlesLabel: "szócikk" },
  { code: "ro", nativeName: "Română", englishName: "Romanian", dir: "ltr", articlesLabel: "articole" },
  { code: "he", nativeName: "עברית", englishName: "Hebrew", dir: "rtl", articlesLabel: "ערכים" },
  { code: "sr", nativeName: "Српски / srpski", englishName: "Serbian", dir: "ltr" },
  { code: "da", nativeName: "Dansk", englishName: "Danish", dir: "ltr", articlesLabel: "artikler" },
  { code: "bg", nativeName: "Български", englishName: "Bulgarian", dir: "ltr", articlesLabel: "статии" },
  { code: "el", nativeName: "Ελληνικά", englishName: "Greek", dir: "ltr", articlesLabel: "λήμματα" },
  { code: "th", nativeName: "ไทย", englishName: "Thai", dir: "ltr", articlesLabel: "บทความ" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr", articlesLabel: "लेख" },
  { code: "bn", nativeName: "বাংলা", englishName: "Bengali", dir: "ltr", articlesLabel: "নিবন্ধ" },
  { code: "ms", nativeName: "Bahasa Melayu", englishName: "Malay", dir: "ltr", articlesLabel: "rencana" },
  { code: "eu", nativeName: "Euskara", englishName: "Basque", dir: "ltr", articlesLabel: "artikulu" },
  { code: "hy", nativeName: "Հայերեն", englishName: "Armenian", dir: "ltr", articlesLabel: "հոդված" },
  { code: "sk", nativeName: "Slovenčina", englishName: "Slovak", dir: "ltr", articlesLabel: "článkov" },
  { code: "lt", nativeName: "Lietuvių", englishName: "Lithuanian", dir: "ltr", articlesLabel: "straipsnių" },
  { code: "et", nativeName: "Eesti", englishName: "Estonian", dir: "ltr", articlesLabel: "artiklit" },
  { code: "sl", nativeName: "Slovenščina", englishName: "Slovenian", dir: "ltr", articlesLabel: "člankov" },
  { code: "hr", nativeName: "Hrvatski", englishName: "Croatian", dir: "ltr", articlesLabel: "članaka" },
  { code: "gl", nativeName: "Galego", englishName: "Galician", dir: "ltr", articlesLabel: "artigos" },
  { code: "lv", nativeName: "Latviešu", englishName: "Latvian", dir: "ltr", articlesLabel: "rakstu" },
  { code: "ka", nativeName: "ქართული", englishName: "Georgian", dir: "ltr" },
  { code: "az", nativeName: "Azərbaycanca", englishName: "Azerbaijani", dir: "ltr" },
  { code: "kk", nativeName: "Қазақша", englishName: "Kazakh", dir: "ltr" },
  { code: "be", nativeName: "Беларуская", englishName: "Belarusian", dir: "ltr" },
  { code: "uz", nativeName: "Oʻzbekcha / ўзбекча", englishName: "Uzbek", dir: "ltr" },
  { code: "ta", nativeName: "தமிழ்", englishName: "Tamil", dir: "ltr" },
  { code: "ur", nativeName: "اردو", englishName: "Urdu", dir: "rtl" },
  { code: "ml", nativeName: "മലയാളം", englishName: "Malayalam", dir: "ltr" },
  { code: "te", nativeName: "తెలుగు", englishName: "Telugu", dir: "ltr" },
  { code: "mr", nativeName: "मराठी", englishName: "Marathi", dir: "ltr" },
  { code: "mk", nativeName: "Македонски", englishName: "Macedonian", dir: "ltr" },
  { code: "sq", nativeName: "Shqip", englishName: "Albanian", dir: "ltr" },
  { code: "is", nativeName: "Íslenska", englishName: "Icelandic", dir: "ltr" },
  { code: "cy", nativeName: "Cymraeg", englishName: "Welsh", dir: "ltr" },
  { code: "af", nativeName: "Afrikaans", englishName: "Afrikaans", dir: "ltr" },
  { code: "sw", nativeName: "Kiswahili", englishName: "Swahili", dir: "ltr" },
  { code: "la", nativeName: "Latina", englishName: "Latin", dir: "ltr" },
  { code: "eo", nativeName: "Esperanto", englishName: "Esperanto", dir: "ltr" },
  { code: "simple", nativeName: "Simple English", englishName: "Simple English", dir: "ltr", locale: "en", articlesLabel: "articles" },
];

export const DEFAULT_LANGUAGE = "en";

/** The ten editions arranged around the globe, in reading order: left then right, top to bottom. */
export const FEATURED_LANGUAGES = ["en", "ja", "de", "fr", "ru", "es", "it", "zh", "pt", "pl"] as const;

export const LANGUAGES: ReadonlyMap<string, WikiLanguage> = new Map(DEFINITIONS.map((l) => [l.code, l]));

/** Cookie holding the reader's chosen edition (read by the server for the first render). */
export const LANGUAGE_COOKIE = "wikihole-lang";

export function isSupportedLanguage(code: unknown): code is string {
  return typeof code === "string" && LANGUAGES.has(code);
}

/** The language for a code, or English for anything unknown. */
export function getLanguage(code: string | null | undefined): WikiLanguage {
  return (code && LANGUAGES.get(code)) || (LANGUAGES.get(DEFAULT_LANGUAGE) as WikiLanguage);
}

/** Normalises untrusted input (cookie, query string) to a supported code. */
export function resolveLanguage(code: unknown): string {
  return isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
}

export function allLanguages(): WikiLanguage[] {
  return DEFINITIONS;
}

export function wikipediaDomain(code: string): string {
  return `${getLanguage(code).code}.wikipedia.org`;
}

export function languageLocale(language: WikiLanguage): string {
  return language.locale ?? language.code;
}

/** Formats an article count the way Wikipedia's portal does: rounded down to thousands, with a "+". */
export function formatArticleCount(count: number, language: WikiLanguage): string {
  const rounded = count >= 1000 ? Math.floor(count / 1000) * 1000 : count;
  let number: string;
  try {
    number = new Intl.NumberFormat(languageLocale(language)).format(rounded);
  } catch {
    number = rounded.toLocaleString("en-US");
  }
  return `${number}+ ${language.articlesLabel ?? "articles"}`;
}

/** Search-box abbreviation, e.g. "EN". */
export function languageAbbreviation(code: string): string {
  return code === "simple" ? "SIMPLE" : code.toUpperCase();
}
