import type { CollectionId } from "./rank";

/**
 * The published snapshot the app reads: two datasets, kept apart, joined by
 * Wikipedia page id. Built offline by the pipeline; nothing here is computed
 * during a page load.
 */

export interface EvidenceItem {
  /** The exact comment, post or page. */
  url: string;
  discussionUrl: string;
  discussionTitle: string | null;
  community: string;
  kind: "comment" | "submission" | "essay";
  /** Unix seconds. */
  at: number;
  /** A short quotation, or the submission's title. */
  excerpt: string;
  /** Why this counted as a recommendation. */
  reason: string;
  /** What decided: "heuristic-…", a model id, or a named review. */
  decidedBy: string;
}

export interface RecommendedArticle {
  id: number;
  title: string;
  qualifying: number;
  discussions: number;
  recommenders: number;
  months: number;
  years: number;
  communities: string[];
  firstAt: number;
  lastAt: number;
  recent12m: number;
  /** Mentions that did not qualify (citations, asides, criticism), kept visible. */
  otherMentions: number;
  criticism: number;
  score: number;
  /** Qualifying recommendations per calendar year, oldest first. */
  timeline: Array<[number, number]>;
  evidence: EvidenceItem[];
}

/** Compact row of the Wikipedia knowledge dataset. */
export interface CatalogueEntry {
  id: number;
  title: string;
  description?: string;
  qid?: string;
  bytes: number;
  monthlyClicks?: number;
  /** Share of arrivals from outside Wikipedia, 0 to 1. */
  externalShare?: number;
  inboundPages?: number;
  incomingLinks?: number;
  assessment?: string;
  /** ORES article topics, e.g. "STEM.Physics". */
  topics?: string[];
  categories?: string[];
  instanceOf?: string[];
  lastRevision?: string;
  /** Why it is in the enriched set: featured, good, unusual, sample, recommended. */
  sources: string[];
  interest: number;
}

export interface RelatedLink {
  id: number;
  title: string;
  kind: "co-recommended" | "reader-path";
  /** Shared discussions, or monthly clicks along the path. */
  weight: number;
}

export interface SourceCoverage {
  id: string;
  name: string;
  status: "ingested" | "partial" | "not-available";
  detail: string;
  mentions: number;
  qualifying: number;
  oldest?: string;
  newest?: string;
}

export interface SnapshotMeta {
  generatedAt: string;
  sources: SourceCoverage[];
  classification: {
    /** Decided mentions per decider, so a reader can see what was and was not done by a model. */
    deciders: Record<string, number>;
    labels: Record<string, number>;
    /** A reviewed random sample: how often the deciders were right, measured rather than assumed. */
    reviewed: {
      sample: number;
      comments: { checked: number; confirmed: number };
      submissions: { checked: number; confirmed: number };
      rejectedComments: { checked: number; missed: number };
    };
  };
  human: { articles: number; qualifying: number; discussions: number };
  catalogue: {
    /** Full scan: every main-namespace, non-redirect page in the dump. */
    articlesScanned: number;
    pagesDumpDate: string | null;
    clickstreamMonth: string | null;
    withClickData: number;
    /** Deep metadata from the API, which covers only part of the catalogue. */
    enriched: number;
    published: number;
  };
  collections: Record<CollectionId, number>;
}

export interface RecommendedSnapshot {
  articles: RecommendedArticle[];
  collections: Record<CollectionId, number[]>;
}
