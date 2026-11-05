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
  /** Of those, how many say so in words rather than sharing the link. */
  inWords: number;
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
  /** complete: everything the source offers was read. partial: known gaps. not-available: nothing could be read. */
  status: "complete" | "partial" | "not-available";
  detail: string;
  mentions: number;
  qualifying: number;
  /** Awaiting review: neither counted nor discarded. */
  undecided: number;
  oldest?: string;
  newest?: string;
}

export interface Rate {
  value: number | null;
  low: number | null;
  high: number | null;
  n: number;
}

export interface ClassifierEvaluation {
  labeller: string;
  labelled: number;
  strata: Array<{ stratum: string; population: number; labelled: number; recommendations: number }>;
  comments: { rulePrecision: Rate; estimatedRuleRecall: number | null; estimatedTrueRecommendations: number | null };
  submissions: { rulePrecision: Rate; estimatedRuleRecall: number | null };
  decided: { acceptedPrecision: Rate };
}

/** Quality of the human dataset. Knows nothing about the catalogue except page ids. */
export interface HumanMeta {
  generatedAt: string;
  sources: SourceCoverage[];
  classification: {
    labels: Record<string, number>;
    /** Which stage decided each counted recommendation. */
    deciders: Record<string, number>;
    evaluation: ClassifierEvaluation;
  };
  resolution: Record<string, number>;
  totals: { mentions: number; articles: number; published: number; qualifying: number; inWords: number; discussions: number; nonEnglishMentions: number };
  collections: Record<CollectionId, number>;
}

/** Quality of the knowledge dataset. Knows nothing about recommendations. */
export interface CatalogueMeta {
  generatedAt: string;
  scan: {
    status: "complete" | "not-run";
    /** Every main-namespace, non-redirect page in the dump. */
    articles: number;
    rowsRead: number;
    pagesDumpDate: string | null;
    withWikidata: number;
    withDescription: number;
    disambiguation: number;
    clickstreamMonth: string | null;
    clickstreamRows: number;
    withClickData: number;
  };
  /** Deep metadata from the API, which covers only part of the catalogue. */
  enrichment: {
    selected: number;
    enriched: number;
    noDocument: number;
    pending: number;
    withTopics: number;
    withAssessment: number;
    withInstanceOf: number;
    featured: number;
    good: number;
    unusual: number;
    sampled: number;
    requestedByOtherDatasets: number;
  };
  published: number;
  notScanned: string[];
}

export interface RecommendedSnapshot {
  articles: RecommendedArticle[];
  collections: Record<CollectionId, number[]>;
}
