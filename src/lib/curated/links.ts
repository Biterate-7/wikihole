import { isArticleNamespace, isValidTitle, normalizeTitle } from "@/lib/wikipedia/titles";

/**
 * Turns the many spellings of a Wikipedia link found in discussions (mobile
 * hosts, index.php, percent-encoding, trailing punctuation) into one article
 * reference. Redirects are resolved later against the live API.
 */

export interface WikipediaReference {
  /** Edition subdomain, e.g. "en". */
  lang: string;
  title: string;
  fragment?: string;
}

const HOST = /^(?:www\.)?(?:([a-z][a-z-]{1,12})\.)?(?:m\.|zero\.)?wikipedia\.org$/;
const NOT_EDITIONS = new Set(["www", "m", "zero", "meta", "commons", "species", "incubator", "donate", "upload", "test"]);
const NON_ARTICLE_TITLES = new Set(["Main Page"]);

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Trailing punctuation swept into a bare URL, keeping balanced parentheses such as "Mercury_(planet)". */
function trimTrailing(raw: string): string {
  let url = raw.replace(/[.,;:!?'"*>\]]+$/, "");
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(/[.,;:!?'"*>\]]+$/, "");
  }
  return url;
}

export function parseWikipediaUrl(raw: string): WikipediaReference | null {
  // Display URLs cut short ("…/Turing_mach...") do not name an article.
  if (/(\.{3}|…)["')\]]?$/.test(raw.trim())) return null;
  let url: URL;
  try {
    const trimmed = trimTrailing(raw.trim());
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = HOST.exec(url.hostname.toLowerCase());
  if (!host) return null;
  const lang = host[1] ?? "en";
  if (NOT_EDITIONS.has(lang)) return null;

  let rawTitle: string | null = null;
  if (url.pathname.startsWith("/wiki/")) {
    rawTitle = url.pathname.slice("/wiki/".length);
  } else if (url.pathname === "/w/index.php" || url.pathname === "/wiki") {
    // Edit, history and diff views are about the page's maintenance, not its content.
    const action = url.searchParams.get("action");
    if (url.searchParams.has("diff") || (action && action !== "view")) return null;
    rawTitle = url.searchParams.get("title");
  }
  if (!rawTitle) return null;

  const title = normalizeTitle(decode(rawTitle));
  if (!isValidTitle(title) || !isArticleNamespace(title) || NON_ARTICLE_TITLES.has(title)) return null;
  const fragment = url.hash ? decode(url.hash.slice(1)) : undefined;
  return { lang, title, ...(fragment ? { fragment } : {}) };
}

/** Finds Wikipedia URLs in plain text, for sources without anchor markup. */
export function findWikipediaUrls(text: string): string[] {
  return text.match(/https?:\/\/(?:[a-z-]+\.)*wikipedia\.org\/[^\s<>"'\]]+/gi) ?? [];
}
