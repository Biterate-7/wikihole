/** Domain types for data retrieved from Wikipedia. Shared by server and client. */

/**
 * Pageview window. 14 days lets a 20-page metadata batch return every page's
 * views in a single response (30 days requires a second request).
 */
export const PAGEVIEW_DAYS = 14;

export type AssessmentClass = "FA" | "A" | "GA" | "B" | "C" | "Start" | "Stub" | "List" | "FL" | "Other";

export interface Thumbnail {
  src: string;
  width: number;
  height: number;
}

export interface PageMeta {
  pageId: number;
  title: string;
  description?: string;
  /** Plain-text intro extract from Wikipedia (TextExtracts). */
  extract?: string;
  /** Wikitext length in bytes. */
  length: number;
  lastEdited?: string;
  thumbnail?: Thumbnail;
  disambiguation: boolean;
  wikidataId?: string;
  /** Best WikiProject assessment class, if the page has been assessed. */
  assessment?: AssessmentClass;
  /** Sum of daily views over the last PAGEVIEW_DAYS days (null = unavailable). */
  recentViews: number | null;
  /** Visible (non-hidden) categories, without the "Category:" prefix. */
  categories: string[];
  /** Word count when the page came from a search result. */
  wordCount?: number;
}

export interface SearchHit {
  pageId: number;
  title: string;
  size: number;
  wordCount: number;
  timestamp?: string;
  /** Snippet split into plain/highlighted runs (never raw HTML). */
  snippet?: Array<{ text: string; match: boolean }>;
}

export interface SearchSuggestion {
  pageId: number;
  title: string;
  description?: string;
  thumbnail?: Thumbnail;
  length: number;
  disambiguation: boolean;
}

export interface FullSearchResult {
  query: string;
  total: number;
  suggestion?: string;
  offset: number;
  nextOffset?: number;
  hits: Array<SearchHit & { description?: string; thumbnail?: Thumbnail; disambiguation: boolean }>;
}

export interface ParsedPageHtml {
  title: string;
  displayTitle: string;
  pageId: number;
  revId: number;
  html: string;
  categories: Array<{ name: string; hidden: boolean }>;
}

export interface PageSummary {
  title: string;
  description?: string;
  extract: string;
  type: string;
  thumbnail?: Thumbnail;
  timestamp?: string;
}
