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

/** Path to the WikiHole reader for a title. */
export function articlePath(title: string, fragment?: string): string {
  const base = `/wiki/${slugFromTitle(title)}`;
  return fragment ? `${base}#${encodeURIComponent(fragment)}` : base;
}

/** Canonical Wikipedia URL for attribution links. */
export function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${slugFromTitle(title)}`;
}

/** Parses a MediaWiki href like "/wiki/Turing_machine#History". */
export function titleFromWikiHref(href: string): { title: string; fragment?: string } | null {
  let path: string;
  if (href.startsWith("/wiki/")) path = href.slice(6);
  else if (href.startsWith("./")) path = href.slice(2);
  else if (href.startsWith("https://en.wikipedia.org/wiki/")) path = href.slice(30);
  else if (href.startsWith("//en.wikipedia.org/wiki/")) path = href.slice(24);
  else return null;
  const [rawTitle, rawFragment] = path.split("#", 2);
  const title = normalizeTitle(safeDecode(rawTitle ?? ""));
  if (!isValidTitle(title)) return null;
  const fragment = rawFragment ? safeDecode(rawFragment) : undefined;
  return { title, fragment };
}
