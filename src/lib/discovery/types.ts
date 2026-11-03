import type { AssessmentClass, Thumbnail } from "@/lib/wikipedia/types";
import type { GroupId } from "./topics";

export const SCORE_COMPONENTS = ["technical", "quality", "depth", "obscurity", "diversity", "exploration"] as const;
export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];
export type Weights = Record<ScoreComponent, number>;

export type FeedPreset = "balanced" | "deep" | "obscure";

export type RejectReason =
  | "disambiguation"
  | "list"
  | "stub"
  | "biography"
  | "entertainment"
  | "sports"
  | "geography"
  | "organization"
  | "non-technical"
  | "date"
  | "missing-extract";

/** A date grounded in a Wikipedia category such as "1936 introductions". */
export interface SourcedDate {
  label: string;
  year: string;
  sourceCategory: string;
}

export interface RelationSource {
  kind: "see-also" | "lead-link" | "body-link" | "shared-category" | "similar-text";
  /** Human-readable explanation, e.g. "Linked from the introduction". */
  label: string;
  /** Shared category name or section title backing the relation. */
  evidence?: string;
}

export interface Discovery {
  /** Language edition, when not English. */
  lang?: string;
  pageId: number;
  title: string;
  description?: string;
  /** First sentences of the Wikipedia intro (TextExtracts), never generated. */
  extract: string;
  thumbnail?: Thumbnail;
  url: string;
  readingMinutes: number;
  group?: GroupId;
  groupLabel?: string;
  subtopic?: string;
  subtopicLabel?: string;
  topCategories: string[];
  date?: SourcedDate;
  assessment?: AssessmentClass;
  recentViews: number | null;
  score: {
    total: number;
    components: Record<ScoreComponent, number>;
    /** Plain-language signals that drove the score. */
    signals: string[];
  };
  relation?: RelationSource;
}

export interface PoolStats {
  sampled: number;
  accepted: number;
  rejected: Partial<Record<RejectReason, number>>;
}
