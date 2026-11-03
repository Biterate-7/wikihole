import { DEFAULT_LANGUAGE, wikipediaDomain } from "@/lib/i18n/languages";

/**
 * Title helpers shared by server and client code. Wikipedia titles use spaces
 * internally and underscores in URLs.
 */

const ILLEGAL_TITLE_CHARS = /[#<>[\]{}|\u0000-\u001f\u007f]/;
const MAX_TITLE_LENGTH = 255;

/** Namespaces whose pages are not encyclopedia articles. */
const NON_ARTICLE_NAMESPACES = new Set([
  "file",
  "image",
  "category",
  "help",
  "wikipedia",
  "wp",
  "template",
  "special",
  "portal",
  "talk",
  "user",
  "user talk",
  "draft",
  "module",
  "mediawiki",
  "book",
  "timedtext",
  "media",
  "project",
  // Localised names in the featured editions (de, fr, es, it, pt, pl, ru, ja, zh).
  ...["datei", "bild", "kategorie", "hilfe", "vorlage", "spezial", "benutzer", "benutzerin", "diskussion", "modul"],
  ...["fichier", "catégorie", "aide", "modèle", "spécial", "utilisateur", "utilisatrice", "discussion", "portail", "projet", "wikipédia"],
  ...["archivo", "imagen", "categoría", "ayuda", "plantilla", "especial", "usuario", "usuaria", "discusión", "wikiproyecto", "módulo"],
  ...["categoria", "aiuto", "speciale", "utente", "discussione", "portale", "progetto"],
  ...["ficheiro", "arquivo", "imagem", "ajuda", "predefinição", "usuário", "utilizador", "discussão", "módulo"],
  ...["plik", "grafika", "kategoria", "pomoc", "szablon", "specjalna", "wikipedysta", "wikipedystka", "dyskusja", "wikiprojekt", "moduł"],
  ...["файл", "изображение", "категория", "справка", "шаблон", "служебная", "участник", "участница", "обсуждение", "портал", "википедия", "проект", "модуль"],
  ...["ファイル", "画像", "カテゴリ", "ヘルプ", "テンプレート", "特別", "利用者", "ノート", "ポータル", "プロジェクト", "モジュール"],
  ...["文件", "檔案", "图像", "圖像", "分类", "分類", "帮助", "幫助", "模板", "特殊", "用户", "使用者", "讨论", "討論", "主题", "主題", "维基百科", "維基百科", "模块"],
]);

export function normalizeTitle(raw: string): string {
  const spaced = raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!spaced) return spaced;
  // MediaWiki capitalises the first character of article titles.
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function isValidTitle(title: string): boolean {
  return (
    title.length > 0 &&
    title.length <= MAX_TITLE_LENGTH &&
    !ILLEGAL_TITLE_CHARS.test(title) &&
    !title.startsWith(".") &&
    !title.startsWith(":")
  );
}

export function isArticleNamespace(title: string): boolean {
  const colon = title.indexOf(":");
  if (colon <= 0) return true;
  return !NON_ARTICLE_NAMESPACES.has(title.slice(0, colon).toLowerCase());
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Converts route segments from /wiki/[...slug] back into a title. */
export function titleFromSlug(segments: string[] | string): string | null {
  const parts = Array.isArray(segments) ? segments : [segments];
  const title = normalizeTitle(parts.map(safeDecode).join("/"));
  return isValidTitle(title) ? title : null;
}

export function slugFromTitle(title: string): string {
  return title
    .replace(/ /g, "_")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

/**
 * Path to the WikiHole reader for a title. English articles live at
 * /wiki/<Title>; other editions at /<lang>/wiki/<Title>.
 */
export function articlePath(title: string, fragment?: string, lang: string = DEFAULT_LANGUAGE): string {
  const prefix = lang === DEFAULT_LANGUAGE ? "" : `/${lang}`;
  const base = `${prefix}/wiki/${slugFromTitle(title)}`;
  return fragment ? `${base}#${encodeURIComponent(fragment)}` : base;
}

/** Full results page for a query in a language edition (English keeps the original URL shape). */
export function searchPath(query: string, lang: string = DEFAULT_LANGUAGE): string {
  const edition = lang === DEFAULT_LANGUAGE ? "" : `&lang=${encodeURIComponent(lang)}`;
  return `/search?q=${encodeURIComponent(query)}${edition}`;
}

/** Canonical Wikipedia URL for attribution links. */
export function wikipediaUrl(title: string, lang: string = DEFAULT_LANGUAGE): string {
  return `https://${wikipediaDomain(lang)}/wiki/${slugFromTitle(title)}`;
}

/** Parses a MediaWiki href like "/wiki/Turing_machine#History" found in an article from edition `lang`. */
export function titleFromWikiHref(href: string, lang: string = DEFAULT_LANGUAGE): { title: string; fragment?: string } | null {
  const host = `//${wikipediaDomain(lang)}/wiki/`;
  let path: string;
  if (href.startsWith("/wiki/")) path = href.slice(6);
  else if (href.startsWith("./")) path = href.slice(2);
  else if (href.startsWith(`https:${host}`)) path = href.slice(host.length + 6);
  else if (href.startsWith(host)) path = href.slice(host.length);
  else return null;
  const [rawTitle, rawFragment] = path.split("#", 2);
  const title = normalizeTitle(safeDecode(rawTitle ?? ""));
  if (!isValidTitle(title)) return null;
  const fragment = rawFragment ? safeDecode(rawFragment) : undefined;
  return { title, fragment };
}
