import { SCORE_COMPONENTS, type FeedPreset, type ScoreComponent, type Weights } from "./types";

/**
 * Discovery model configuration. Weights are relative and normalised to sum
 * to 1. The defaults follow the product brief; presets reshape them for the
 * feed's "Deep" and "Obscure" modes. DISCOVERY_WEIGHTS (JSON) overrides the
 * balanced preset at deploy time.
 */

export const DEFAULT_WEIGHTS: Weights = {
  technical: 25,
  quality: 20,
  depth: 20,
  obscurity: 15,
  diversity: 10,
  exploration: 10,
};

const PRESET_OVERRIDES: Record<Exclude<FeedPreset, "balanced">, Partial<Weights>> = {
  deep: { quality: 30, depth: 30, obscurity: 5 },
  obscure: { obscurity: 35, quality: 20, technical: 20, depth: 15 },
};

export const MODEL = {
  /** Wikitext bytes below which an article counts as a stub for the feed. */
  minLengthBytes: 6000,
  /** Candidates whose technical score falls below this are rejected from the feed. */
  minTechnical: 0.3,
  /** Words per minute used for reading-time estimates. */
  wordsPerMinute: 230,
  /** Wikitext bytes per readable word (markup and citations inflate length) when no word count is available. */
  bytesPerWord: 12,
  /** Standard deviation (in score points) of exploration noise added to rankings. */
  explorationNoise: 5,
} as const;

export const COMPONENT_LABELS: Record<ScoreComponent, string> = {
  technical: "Technical relevance",
  quality: "Article quality",
  depth: "Conceptual depth",
  obscurity: "Obscurity",
  diversity: "Topic diversity",
  exploration: "Exploration relevance",
};

export const COMPONENT_DESCRIPTIONS: Record<ScoreComponent, string> = {
  technical: "Technical vocabulary in the title, description, categories and intro.",
  quality: "WikiProject assessment class and article length.",
  depth: "Density of formal concepts (theorems, models, algorithms) and curiosity cues.",
  obscurity: "Low 30-day pageviews, discounted when article quality is weak.",
  diversity: "Distance from topics already shown in this batch.",
  exploration: "Strength of the link to the current topic or article.",
};

function parseEnvWeights(raw: string | undefined): Partial<Weights> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Weights> = {};
    for (const key of SCORE_COMPONENTS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function normalizeWeights(weights: Weights): Weights {
  const total = SCORE_COMPONENTS.reduce((sum, k) => sum + weights[k], 0) || 1;
  return Object.fromEntries(SCORE_COMPONENTS.map((k) => [k, weights[k] / total])) as Weights;
}

export function weightsFor(preset: FeedPreset = "balanced", envOverride = process.env.DISCOVERY_WEIGHTS): Weights {
  const base: Weights = { ...DEFAULT_WEIGHTS, ...parseEnvWeights(envOverride) };
  return normalizeWeights(preset === "balanced" ? base : { ...base, ...PRESET_OVERRIDES[preset] });
}
