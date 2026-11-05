import type { Submission } from "@/lib/hackernews/types";
import type { AssessmentClass, Thumbnail } from "@/lib/wikipedia/types";

/**
 * A rabbit hole: the knowledge graph WikiHole builds from a discovery source
 * such as a Hacker News submission. Shared by server and client.
 */

export const RELATION_KINDS = ["direct", "prerequisite", "historical", "descendant", "adjacent"] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export type ExplorationLevel = 1 | 2 | 3 | 4;

export const LEVEL_LABELS: Record<ExplorationLevel, string> = {
  1: "Directly related",
  2: "Secondary connections",
  3: "Deeper technical and historical",
  4: "Unexpected connections",
};

export const RELATION_LABELS: Record<RelationKind, string> = {
  direct: "Direct",
  prerequisite: "Prerequisite",
  historical: "Historical",
  descendant: "Descendant",
  adjacent: "Adjacent",
};

export type NodeKind =
  | "submission"
  | "programming-language"
  | "software"
  | "technology"
  | "algorithm"
  | "mathematics"
  | "science"
  | "company"
  | "organization"
  | "person"
  | "event"
  | "research"
  | "place"
  | "concept";

export interface HoleNode {
  /** "root" for the submission, otherwise `p<pageId>`. */
  id: string;
  pageId?: number;
  title: string;
  level: 0 | ExplorationLevel;
  kind: NodeKind;
  /** Relation to the node that introduced it ("primary" for the main article). */
  role: "submission" | "primary" | RelationKind;
  /** Node that introduced this one (its structural parent). */
  parent?: string;
  description?: string;
  /** Intro sentences from Wikipedia (TextExtracts), never generated. */
  extract?: string;
  thumbnail?: Thumbnail;
  readingMinutes?: number;
  assessment?: AssessmentClass;
  /** Relevance to the submission, 0..1. */
  relevance: number;
  /** Entity-resolution confidence (level 1 only). */
  confidence?: number;
  /** Phrases in the submission that resolved to this article (level 1 only). */
  mentionedAs?: string[];
}

export type EdgeEvidence =
  | "submission"
  | "definition"
  | "lead"
  | "infobox"
  | "history-section"
  | "legacy-section"
  | "usage-section"
  | "section"
  | "see-also"
  | "link"
  | "similar-text";

export interface HoleEdge {
  id: string;
  source: string;
  target: string;
  kind: RelationKind;
  /** Short label, e.g. "Prerequisite". */
  label: string;
  /** One sentence explaining the relation and citing where it comes from. */
  explanation: string;
  evidence: EdgeEvidence;
  /** Section heading or infobox label backing the relation. */
  detail?: string;
  /** True for the edge that introduced `target` into the graph (tree edges). */
  structural: boolean;
}

export interface ExtractedEntity {
  entity: string;
  source: "title" | "text" | "comments" | "ai";
  status: "resolved" | "unresolved";
  title?: string;
  confidence?: number;
  method?: string;
  kind?: NodeKind;
  reasons: string[];
  /** Why it did not resolve. */
  reason?: string;
  closest?: { title: string; confidence: number };
}

export const QUALITY_COMPONENTS = ["coverage", "confidence", "depth", "connectivity", "articles", "technical"] as const;
export type QualityComponent = (typeof QUALITY_COMPONENTS)[number];

export interface HoleQuality {
  /** 0..100. */
  score: number;
  status: "complete" | "insufficient";
  components: Record<QualityComponent, number>;
  /** Plain-language reasons, especially when insufficient. */
  notes: string[];
}

export const HN_COMPONENTS = ["technical", "novelty", "relevance", "entities", "coverage", "connections", "engagement"] as const;
export type HnComponent = (typeof HN_COMPONENTS)[number];

export interface SubmissionScore {
  /** 0..100. */
  total: number;
  components: Record<HnComponent, number>;
  signals: string[];
}

export interface ExplorationSummary {
  primary?: { title: string; description?: string; lead: string };
  secondary: string[];
  prerequisites: string[];
  historical: string[];
  descendants: string[];
  adjacent: string[];
  disciplines: Array<{ id: string; label: string }>;
}

export interface Exploration {
  /** Builder version: explorations from older builders are rebuilt. */
  version: number;
  submission: Submission;
  builtAt: number;
  summary: ExplorationSummary;
  nodes: HoleNode[];
  edges: HoleEdge[];
  entities: ExtractedEntity[];
  quality: HoleQuality;
  score: SubmissionScore;
  /** Inputs to the final score that are not otherwise recoverable (for re-scoring when engagement changes). */
  metrics: { resolvedEntities: number; obscurity: number; relevance: number };
}

/** Feed entry: a submission with the essentials of its rabbit hole. */
export interface ExplorationPreview {
  submission: Submission;
  primary?: { title: string; description?: string; lead: string };
  tags: string[];
  disciplines: Array<{ id: string; label: string }>;
  articleCount: number;
  quality: number;
  score: SubmissionScore;
  builtAt: number;
}
