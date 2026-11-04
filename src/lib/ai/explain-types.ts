/** Requests and results for on-demand explanations. Shared by the API route and the browser. */

export const EXPLAIN_LEVELS = ["simple", "standard", "advanced"] as const;
export type ExplainLevel = (typeof EXPLAIN_LEVELS)[number];

export const PASSAGE_ACTIONS = ["explain", "summarise", "simplify", "connections"] as const;
export type PassageAction = (typeof PASSAGE_ACTIONS)[number];

interface ArticleRef {
  title: string;
  lang?: string;
}

export type ExplainRequest = ArticleRef &
  (
    | {
        kind: "term";
        /** The words as they appear in the article. */
        term: string;
        /** The Wikipedia article for this term, when the article links to one. */
        link?: string;
        /** Section the term was found in; absent for the lead. */
        sectionId?: string;
        level: ExplainLevel;
        deeper?: boolean;
      }
    | {
        kind: "passage";
        action: PassageAction;
        passage: string;
        /** Articles the selected passage links to. */
        links?: string[];
      }
    | { kind: "section"; sectionId: string }
    | { kind: "diff"; from?: number; to: number }
  );

/** A generated result. Every field is model output, shown only under an "AI-generated" label. */
export interface Explanation {
  /** The main text, as paragraphs. */
  text: string[];
  /** A plainer restatement, for terms. */
  simpler?: string;
  /** Linked articles and why they relate; every title is checked against the article's links. */
  connections?: Array<{ title: string; reason: string }>;
  model: string;
}

export type ExplainResponse = { enabled: false } | { enabled: true; explanation: Explanation };
