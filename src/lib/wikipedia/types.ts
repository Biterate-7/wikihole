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
  /** Language edition, when not English. */
  lang?: string;
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

export interface SiteStatistics {
  lang: string;
  /** Content-namespace article count reported by the edition's siteinfo. */
  articles: number;
}

export interface PageSummary {
  title: string;
  description?: string;
  extract: string;
  type: string;
  thumbnail?: Thumbnail;
  timestamp?: string;
}

/** Who made an edit, as far as Wikimedia discloses it. */
export interface Contributor {
  kind: "registered" | "temporary" | "anonymous" | "hidden";
  /** Account name. Absent for IP editors (shown as anonymous) and hidden users. */
  name?: string;
}

/** An edit summary, split into the section MediaWiki marks and the editor's own text. */
export interface EditSummary {
  section?: string;
  text: string;
}

export interface Revision {
  id: number;
  parentId: number;
  timestamp: string;
  contributor: Contributor;
  /** Null when the editor left none, or it has been hidden (see summaryHidden). */
  summary: EditSummary | null;
  summaryHidden: boolean;
  /** Page size after this edit, in bytes. */
  size: number;
  /** Change in bytes from the parent revision. Null when the parent's size is unknown. */
  sizeDelta: number | null;
  minor: boolean;
  /** Tagged by MediaWiki as later reverted. */
  reverted: boolean;
}

export interface RevisionPage {
  revisions: Revision[];
  /** Revision id to continue from for older edits, when there are more. */
  olderFrom?: number;
}

/** A count from Wikimedia's history API, which stops counting at a limit. */
export interface HistoryCount {
  count: number;
  /** True when the real number is at least `count`. */
  capped: boolean;
}

export interface RecentActivity {
  days: number;
  edits: number;
  /** False when the window holds more edits than were fetched, making `edits` a lower bound. */
  complete: boolean;
  contributors: number;
  bytesAdded: number;
  bytesRemoved: number;
}

/** Everything the reader shows about an article's history. A part Wikimedia could not supply is null. */
export interface ArticleHistory {
  edits: HistoryCount | null;
  contributors: HistoryCount | null;
  created: { timestamp: string; contributor: Contributor } | null;
  recent: Revision[] | null;
  activity: RecentActivity | null;
}

/** A run of diff text. `changed` marks the words the edit actually touched. */
export interface DiffRun {
  text: string;
  changed: boolean;
}

export type DiffRow =
  /** "Line 475:" markers from the compare API. */
  | { k: "lines"; from: number | null; to: number | null }
  | { k: "context"; text: string }
  | { k: "change"; removed: DiffRun[] | null; added: DiffRun[] | null };

export interface RevisionSide {
  id: number;
  timestamp?: string;
  contributor: Contributor;
  summary: EditSummary | null;
  summaryHidden: boolean;
  size?: number;
}

export interface RevisionComparison {
  title: string;
  /** Null when `to` is the article's first revision. */
  from: RevisionSide | null;
  to: RevisionSide;
  /** Revision before `from`, for stepping to the older edit. */
  olderId?: number;
  /** Revision after `to`, for stepping to the newer edit. */
  newerId?: number;
  rows: DiffRow[];
  /** Characters inside changed runs. Counted from the diff itself, not from page sizes. */
  charsAdded: number;
  charsRemoved: number;
  truncated: boolean;
}
