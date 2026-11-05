import { HN_COMPONENTS, type HnComponent, type HoleQuality, type SubmissionScore } from "@/lib/discovery/hole-types";
import { DISCIPLINE_BY_ID, technicalTermCount, type DisciplineId } from "@/lib/discovery/topic-classification";
import { countDistinct, termRegex } from "@/lib/discovery/lexicon";
import type { Submission, SubmissionRejectReason } from "./types";

/**
 * Relevance ranking for Hacker News submissions. Popularity is deliberately
 * a minor, saturating signal: a niche technical post with 30 points can
 * outrank a generic one with 2,000. Ranking happens twice:
 *
 * 1. a cheap pre-score from the title, body and domain decides which
 *    submissions are worth turning into rabbit holes;
 * 2. the final score adds what the rabbit hole actually achieved: how many
 *    entities resolved, how much of it Wikipedia covers, and how connected
 *    the resulting graph is.
 *
 * Weights are relative; HN_RANKING_WEIGHTS (JSON) overrides them.
 */

export type HnWeights = Record<HnComponent, number>;

export const DEFAULT_HN_WEIGHTS: HnWeights = {
  technical: 22,
  novelty: 16,
  relevance: 12,
  entities: 12,
  coverage: 14,
  connections: 14,
  engagement: 10,
};

export const HN_COMPONENT_LABELS: Record<HnComponent, string> = {
  technical: "Technical depth",
  novelty: "Intellectual novelty",
  relevance: "Topic relevance",
  entities: "Entity richness",
  coverage: "Wikipedia coverage",
  connections: "Connection potential",
  engagement: "Engagement",
};

export const HN_COMPONENT_DESCRIPTIONS: Record<HnComponent, string> = {
  technical: "Technical vocabulary in the title and post, and research or source-code domains.",
  novelty: "Cues of original work, history, explanation or research: papers, internals, proofs, older material.",
  relevance: "How close the submission's disciplines are to WikiHole's interests (CS, AI, maths, physics, history of technology).",
  entities: "Distinct concepts, technologies and names that resolved to Wikipedia articles.",
  coverage: "Quality and confidence of the Wikipedia articles found.",
  connections: "Depth and interconnection of the resulting article graph.",
  engagement: "Points and comments, log-scaled and capped so popularity cannot dominate.",
};

export const HN_MODEL = {
  /** Pre-score below which a submission is not processed. */
  minPrescore: 12,
  /** Penalty multiplier below which a submission is treated as off-topic. */
  minPenalty: 0.45,
} as const;

function parseEnvWeights(raw: string | undefined): Partial<HnWeights> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<HnWeights> = {};
    for (const key of HN_COMPONENTS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function hnWeights(envOverride = process.env.HN_RANKING_WEIGHTS): HnWeights {
  const merged: HnWeights = { ...DEFAULT_HN_WEIGHTS, ...parseEnvWeights(envOverride) };
  const total = HN_COMPONENTS.reduce((s, k) => s + merged[k], 0) || 1;
  return Object.fromEntries(HN_COMPONENTS.map((k) => [k, merged[k] / total])) as HnWeights;
}

/* ------------------------------------------------------------------------ */
/* Signals                                                                   */
/* ------------------------------------------------------------------------ */

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const saturate = (n: number, scale: number) => 1 - Math.exp(-n / scale);

const NOVELTY_RE = termRegex([
  "paper", "proof", "prove", "theorem", "internals", "under the hood", "from scratch", "deep dive", "how it works",
  "how does", "explained", "explainer", "visualiz", "interactive", "simulat", "reverse engineer", "decompil",
  "history of", "the story of", "origins of", "forgotten", "lost", "rediscover", "obscure", "unsolved", "open problem",
  "paradox", "discover", "new algorithm", "novel", "breakthrough", "faster than", "implementation", "implementing",
  "design of", "anatomy of", "postmortem", "post-mortem", "analysis of", "a look at", "notes on", "lessons from",
  "how the", "why does", "why is", "what is", "primer", "derivation", "formal", "verified", "benchmark", "measur",
]);

const LOW_VALUE_RE = termRegex([
  "career", "hiring", "who is hiring", "who wants to be hired", "freelanc", "salary", "salaries", "interview",
  "resume", "job offer", "layoff", "laid off", "burnout", "engineering manager", "promotion", "remote work", "work from home",
  "productivity tips", "side hustle", "passive income", "make money", "how do you", "what do you use", "what are you",
  "recommend me", "should i", "i quit", "i'm leaving", "why i left", "my journey", "personal update", "rant",
  "discount", "% off", "black friday", "sale", "sponsored", "webinar", "giveaway", "coupon", "waitlist",
  "election", "president", "senate", "congress", "trump", "biden", "parliament", "tariff", "lawsuit", "sues",
  "stock price", "earnings", "valuation", "funding round", "raises $", "acquires", "acquisition",
]);

const RESEARCH_DOMAINS = /(^|\.)(arxiv\.org|acm\.org|ieee\.org|nature\.com|science\.org|quantamagazine\.org|biorxiv\.org|plos\.org|springer\.com|openreview\.net|aclanthology\.org|semanticscholar\.org|researchgate\.net|ias\.edu|mit\.edu|stanford\.edu|berkeley\.edu|cmu\.edu|cam\.ac\.uk|ox\.ac\.uk|ethz\.ch|inria\.fr|mpg\.de|caltech\.edu)$|\.edu$|\.ac\.[a-z]{2}$/i;
const CODE_DOMAINS = /(^|\.)(github\.com|gitlab\.com|codeberg\.org|sr\.ht|sourceforge\.net|crates\.io|pypi\.org)$/i;
const ARCHIVE_DOMAINS = /(^|\.)(archive\.org|computerhistory\.org|bitsavers\.org|folklore\.org|ultimatehistoryofcomputing|righto\.com)$/i;
const NEWS_DOMAINS = /(^|\.)(bloomberg\.com|reuters\.com|cnbc\.com|wsj\.com|ft\.com|businessinsider\.com|forbes\.com|cnn\.com|foxnews\.com|nypost\.com)$/i;

/** Interest-weighted relevance of a set of scored disciplines, 0..1. */
export function disciplineRelevance(disciplines: Array<{ id: DisciplineId; score: number }>): number {
  const total = disciplines.reduce((s, d) => s + d.score, 0);
  if (total <= 0) return 0;
  return disciplines.reduce((r, d) => r + (d.score / total) * (DISCIPLINE_BY_ID.get(d.id)?.interest ?? 0.5), 0);
}

export interface Prescore {
  total: number;
  components: Pick<Record<HnComponent, number>, "technical" | "novelty" | "relevance" | "engagement">;
  penalty: number;
  signals: string[];
  reject: SubmissionRejectReason | null;
}

export function engagementScore(submission: Pick<Submission, "score" | "comments">): number {
  return clamp(0.6 * (Math.log10(submission.score + 1) / 3) + 0.4 * (Math.log10(submission.comments + 1) / 2.7));
}

/**
 * Pre-score from the submission alone. `disciplines` and `entityCount` come
 * from the (local, request-free) entity extraction.
 */
export function prescore(
  submission: Submission,
  disciplines: Array<{ id: DisciplineId; score: number }>,
  entityCount: number,
): Prescore {
  const signals: string[] = [];
  if (submission.category === "job") return { total: 0, components: { technical: 0, novelty: 0, relevance: 0, engagement: 0 }, penalty: 0, signals: ["Job posting"], reject: "job" };
  if (submission.category === "poll") return { total: 0, components: { technical: 0, novelty: 0, relevance: 0, engagement: 0 }, penalty: 0, signals: ["Poll"], reject: "poll" };

  const title = submission.subject.toLowerCase();
  const body = (submission.text ?? "").slice(0, 3000).toLowerCase();
  const domain = submission.domain ?? "";

  let techHits = technicalTermCount(title) * 1.5 + Math.min(4, technicalTermCount(body) * 0.5);
  if (RESEARCH_DOMAINS.test(domain)) {
    techHits += 1.5;
    signals.push(`Research source (${domain})`);
  } else if (CODE_DOMAINS.test(domain)) {
    techHits += 1;
    signals.push(`Source code (${domain})`);
  }
  const technical = saturate(techHits, 2.5);

  let noveltyHits = countDistinct(NOVELTY_RE, `${title} ${body.slice(0, 800)}`);
  if (submission.year && submission.year < new Date().getFullYear() - 1) {
    noveltyHits += 1.5;
    signals.push(`Older material (${submission.year})`);
  }
  if (ARCHIVE_DOMAINS.test(domain)) {
    noveltyHits += 1;
    signals.push(`Archive or history source (${domain})`);
  }
  if (/\[pdf\]|\(pdf\)/i.test(submission.title)) noveltyHits += 0.5;
  if (submission.category === "show" && CODE_DOMAINS.test(domain)) noveltyHits += 0.5;
  const novelty = saturate(noveltyHits, 1.6);

  const relevance = disciplineRelevance(disciplines);
  const top = disciplines[0] && DISCIPLINE_BY_ID.get(disciplines[0].id);
  if (top) signals.push(`Discipline: ${top.label}`);

  const engagement = engagementScore(submission);

  let penalty = 1;
  const lowValue = countDistinct(LOW_VALUE_RE, `${title} ${body.slice(0, 600)}`);
  if (lowValue > 0) {
    penalty *= Math.pow(0.55, Math.min(lowValue, 3));
    signals.push("Career, promotional or general-news language");
  }
  if (NEWS_DOMAINS.test(domain)) penalty *= 0.75;
  if (submission.category === "launch") penalty *= 0.8;
  if (/!{2,}|\b[A-Z]{6,}\b.*\b[A-Z]{6,}\b/.test(submission.title)) penalty *= 0.6;
  if (submission.subject.split(/\s+/).length < 3 && entityCount === 0) penalty *= 0.5;

  let reject: SubmissionRejectReason | null = null;
  if (technical === 0 && entityCount === 0) reject = "low-information";
  else if (penalty < HN_MODEL.minPenalty) reject = "off-topic";

  const weights = hnWeights();
  const entityRichness = saturate(entityCount, 3);
  const partial = weights.technical + weights.novelty + weights.relevance + weights.engagement + weights.entities;
  const total =
    (100 *
      (weights.technical * technical +
        weights.novelty * novelty +
        weights.relevance * relevance +
        weights.engagement * engagement +
        weights.entities * entityRichness) *
      penalty) /
    partial;

  return {
    total: Math.round(total * 10) / 10,
    components: { technical, novelty, relevance, engagement },
    penalty,
    signals,
    reject,
  };
}

/**
 * Final score once the rabbit hole is built: the pre-score signals plus
 * entity richness, Wikipedia coverage and connection potential.
 */
export function finalScore(
  pre: Prescore,
  hole: { resolvedEntities: number; quality: HoleQuality; obscurity: number; relevance: number },
): SubmissionScore {
  const weights = hnWeights();
  const components: Record<HnComponent, number> = {
    technical: clamp(0.6 * pre.components.technical + 0.4 * hole.quality.components.technical),
    novelty: clamp(0.75 * pre.components.novelty + 0.25 * hole.obscurity),
    // The articles a submission resolves to ground its topic even when its title has no technical vocabulary.
    relevance: Math.max(pre.components.relevance, hole.relevance),
    entities: saturate(hole.resolvedEntities, 2.5),
    coverage: clamp(0.5 * hole.quality.components.coverage + 0.25 * hole.quality.components.confidence + 0.25 * hole.quality.components.articles),
    connections: clamp(0.5 * hole.quality.components.connectivity + 0.5 * hole.quality.components.depth),
    engagement: pre.components.engagement,
  };
  let total = 0;
  for (const key of HN_COMPONENTS) total += weights[key] * components[key];
  return {
    total: Math.round(100 * total * pre.penalty * 10) / 10,
    components: Object.fromEntries(HN_COMPONENTS.map((k) => [k, Math.round(components[k] * 100) / 100])) as Record<HnComponent, number>,
    signals: pre.signals.slice(0, 4),
  };
}
