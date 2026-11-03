import { PAGEVIEW_DAYS, type AssessmentClass, type PageMeta } from "@/lib/wikipedia/types";
import { wikipediaUrl } from "@/lib/wikipedia/titles";
import { MODEL } from "./config";
import {
  BIOGRAPHY_CATEGORY,
  CURIOSITY_TERMS,
  DATE_TITLE,
  DEPTH_TERMS,
  ENTERTAINMENT_CATEGORY,
  GEOGRAPHY_CATEGORY,
  GROUP_TERMS,
  LIST_TITLE,
  NUMBER_TITLE,
  ORGANIZATION_CATEGORY,
  PRODUCT_DESCRIPTION,
  REFERENCE_ENTRY_CATEGORY,
  SPORTS_CATEGORY,
  countDistinct,
  termRegex,
} from "./lexicon";
import { GROUPS, SUBTOPICS, type GroupId } from "./topics";
import type { Discovery, RejectReason, RelationSource, ScoreComponent, SourcedDate, Weights } from "./types";

/**
 * Feature extraction and scoring for the discovery model. Every feature is
 * derived from real Wikipedia metadata (assessment, length, pageviews,
 * categories, description, intro extract). All features are in [0, 1].
 */

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const saturate = (hits: number, scale: number) => 1 - Math.exp(-hits / scale);

const GROUP_REGEX = Object.fromEntries(
  Object.entries(GROUP_TERMS).map(([group, terms]) => [group, termRegex(terms)]),
) as Record<GroupId, RegExp>;
const ALL_TECH_REGEX = termRegex([...new Set(Object.values(GROUP_TERMS).flat())]);
const DEPTH_REGEX = termRegex(DEPTH_TERMS);
const CURIOSITY_REGEX = termRegex(CURIOSITY_TERMS);
const MATH_SYMBOLS = /[∑∫∂√≤≥≠∞∈∉⊂⊆∀∃→↦⊕⊗λσφψΩωπθ]/g;

const ASSESSMENT_SCORE: Record<AssessmentClass, number> = {
  FA: 1,
  FL: 0.7,
  A: 0.95,
  GA: 0.9,
  B: 0.72,
  C: 0.55,
  Start: 0.35,
  Stub: 0.1,
  List: 0.3,
  Other: 0.45,
};

export interface Features {
  technical: number;
  quality: number;
  depth: number;
  obscurity: number;
  /** Penalty multiplier in (0, 1] for low-curiosity page types. */
  penalty: number;
  group?: GroupId;
  isBiography: boolean;
  signals: string[];
}

export interface Candidate {
  meta: PageMeta;
  /** Subtopic the candidate was drawn from, if any. */
  subtopic?: string;
  /** Relation to the article being explored (Rabbit Hole). */
  relation?: RelationSource;
  /** Strength of relation to the current context, 0..1. */
  exploration: number;
}

function haystack(meta: PageMeta): { strong: string; extract: string } {
  return {
    strong: `${meta.title} ${meta.description ?? ""} ${meta.categories.join(" ")}`.toLowerCase(),
    extract: (meta.extract ?? "").toLowerCase(),
  };
}

export function lengthScore(bytes: number): number {
  return clamp((Math.log10(Math.max(bytes, 1)) - Math.log10(4000)) / (Math.log10(90000) - Math.log10(4000)));
}

export function classifyGroup(meta: PageMeta): GroupId | undefined {
  const { strong, extract } = haystack(meta);
  let best: GroupId | undefined;
  let bestScore = 0;
  for (const group of GROUPS) {
    if (group.id === "curiosities") continue;
    const re = GROUP_REGEX[group.id];
    const score = countDistinct(re, strong) * 2 + countDistinct(re, extract);
    if (score > bestScore) {
      best = group.id;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : undefined;
}

export function isBiography(meta: PageMeta): boolean {
  return meta.categories.some((c) => BIOGRAPHY_CATEGORY.test(c));
}

export function extractFeatures(meta: PageMeta): Features {
  const signals: string[] = [];
  const { strong, extract } = haystack(meta);

  const techHits = countDistinct(ALL_TECH_REGEX, strong) * 1.5 + countDistinct(ALL_TECH_REGEX, extract);
  const technical = saturate(techHits, 4);

  const assessed = meta.assessment ? ASSESSMENT_SCORE[meta.assessment] : undefined;
  const size = lengthScore(meta.length);
  const quality = assessed !== undefined ? 0.55 * assessed + 0.45 * size : 0.25 * 0.45 + 0.75 * size;
  if (meta.assessment === "FA") signals.push("Featured article");
  else if (meta.assessment === "GA") signals.push("Good article");
  else if (meta.assessment === "A" || meta.assessment === "B") signals.push(`Assessed ${meta.assessment}-class`);

  const depthHits = countDistinct(DEPTH_REGEX, `${strong} ${extract}`);
  const symbols = new Set((meta.extract ?? "").match(MATH_SYMBOLS) ?? []).size;
  const words = (meta.extract ?? "").split(/\s+/).filter(Boolean);
  const avgWord = words.length ? words.reduce((n, w) => n + w.length, 0) / words.length : 0;
  const curiosityHits = countDistinct(CURIOSITY_REGEX, `${strong} ${extract}`);
  const curiosity = saturate(curiosityHits, 1.5);
  const depth = clamp(
    0.45 * saturate(depthHits + symbols, 3) + 0.15 * clamp((avgWord - 4.4) / 2) + 0.15 * size + 0.25 * curiosity,
  );
  if (curiosityHits > 0) {
    const cue = (`${strong} ${extract}`.match(CURIOSITY_REGEX) ?? [])[0];
    if (cue) signals.push(`Curiosity cue: “${cue.toLowerCase()}…”`);
  }

  let obscurity = 0.5;
  if (meta.recentViews !== null) {
    // Calibrated on a 30-day scale: ~30 views/month is maximally obscure, ~20k is mainstream.
    const monthly = (meta.recentViews * 30) / PAGEVIEW_DAYS;
    const rarity = 1 - clamp((Math.log10(monthly + 1) - 1.5) / (4.3 - 1.5));
    // Obscurity only counts when the article is substantial: rare + thin is not a discovery.
    obscurity = rarity * (0.3 + 0.7 * quality);
    if (monthly < 1500) signals.push(`${meta.recentViews.toLocaleString("en-US")} views in ${PAGEVIEW_DAYS} days`);
  }

  let penalty = 1;
  const bio = isBiography(meta);
  if (bio) penalty *= 0.45;
  if (meta.categories.some((c) => REFERENCE_ENTRY_CATEGORY.test(c))) penalty *= 0.6;
  if (meta.categories.some((c) => ORGANIZATION_CATEGORY.test(c))) penalty *= 0.6;
  if (meta.description && PRODUCT_DESCRIPTION.test(meta.description)) penalty *= 0.7;

  return { technical, quality, depth, obscurity, penalty, group: classifyGroup(meta), isBiography: bio, signals };
}

/** Hard quality gate for the feed and random discovery. */
export function rejectReason(meta: PageMeta, features: Features, { strict = true } = {}): RejectReason | null {
  if (meta.disambiguation) return "disambiguation";
  if (LIST_TITLE.test(meta.title) || meta.assessment === "List" || meta.assessment === "FL") return "list";
  if (DATE_TITLE.test(meta.title) || NUMBER_TITLE.test(meta.title)) return "date";
  if (!meta.extract || meta.extract.length < 80) return "missing-extract";
  const cats = meta.categories;
  if (cats.some((c) => SPORTS_CATEGORY.test(c))) return "sports";
  if (cats.some((c) => ENTERTAINMENT_CATEGORY.test(c))) return "entertainment";
  if (cats.some((c) => GEOGRAPHY_CATEGORY.test(c))) return "geography";
  if (!strict) return null;
  if (meta.assessment === "Stub" || meta.length < MODEL.minLengthBytes) return "stub";
  if (features.isBiography) return "biography";
  if (cats.some((c) => ORGANIZATION_CATEGORY.test(c))) return "organization";
  if (features.technical < MODEL.minTechnical) return "non-technical";
  return null;
}

const DATE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^(\d{3,4}s?) introductions$/i, label: "Introduced" },
  { re: /^.*introductions in (\d{3,4}s?)$/i, label: "Introduced" },
  { re: /^(\d{3,4}s?) inventions$/i, label: "Invented" },
  { re: /^.*(?:created|developed|invented) in (\d{3,4}s?)$/i, label: "Created" },
  { re: /^(\d{3,4}s?) (?:in science|in computing|in mathematics|in physics|in biology|in technology|in spaceflight)$/i, label: "Dated" },
  { re: /^(\d{3,4}s?) (?:discoveries|works)$/i, label: "Discovered" },
  { re: /^.*(?:discovered|described|established|founded|launched) in (\d{3,4}s?)$/i, label: "Dated" },
  { re: /^(\d{3,4}s?) (?:software|robots|computers)$/i, label: "Released" },
];

/** Finds a historical date grounded in the article's own categories. */
export function sourcedDate(categories: string[]): SourcedDate | undefined {
  for (const { re, label } of DATE_PATTERNS) {
    for (const category of categories) {
      const m = re.exec(category);
      if (m?.[1]) return { label, year: m[1], sourceCategory: category };
    }
  }
  return undefined;
}

export function readingMinutes(meta: PageMeta): number {
  const words = meta.wordCount && meta.wordCount > 0 ? meta.wordCount : meta.length / MODEL.bytesPerWord;
  return Math.max(1, Math.round(words / MODEL.wordsPerMinute));
}

const CATEGORY_NOISE = /\b(articles?|pages?|wikipedia|cs1|webarchive|use dmy|use mdy|short description|stub)\b/i;

export function topCategories(categories: string[], limit = 3): string[] {
  return categories.filter((c) => !CATEGORY_NOISE.test(c) && !/^\d/.test(c)).slice(0, limit);
}

/** Combines features with weights; diversity is supplied by the selector. */
export function combine(
  f: Features,
  exploration: number,
  diversity: number,
  weights: Weights,
): { total: number; components: Record<ScoreComponent, number> } {
  const components: Record<ScoreComponent, number> = {
    technical: f.technical,
    quality: f.quality,
    depth: f.depth,
    obscurity: f.obscurity,
    diversity,
    exploration,
  };
  let total = 0;
  for (const key of Object.keys(components) as ScoreComponent[]) total += weights[key] * components[key];
  return { total: Math.round(100 * total * f.penalty * 10) / 10, components };
}

export function toDiscovery(
  candidate: Candidate,
  features: Features,
  score: { total: number; components: Record<ScoreComponent, number> },
): Discovery {
  const { meta } = candidate;
  const sub = candidate.subtopic ? SUBTOPICS[candidate.subtopic] : undefined;
  const groupId =
    (sub && GROUPS.find((g) => g.subtopics.includes(sub.slug))?.id) ?? features.group ?? undefined;
  const group = groupId ? GROUPS.find((g) => g.id === groupId) : undefined;
  const signals = [...features.signals];
  if (candidate.relation) signals.unshift(candidate.relation.label);
  return {
    ...(meta.lang ? { lang: meta.lang } : {}),
    pageId: meta.pageId,
    title: meta.title,
    ...(meta.description ? { description: meta.description } : {}),
    extract: meta.extract ?? "",
    ...(meta.thumbnail ? { thumbnail: meta.thumbnail } : {}),
    url: wikipediaUrl(meta.title, meta.lang),
    readingMinutes: readingMinutes(meta),
    ...(group ? { group: group.id, groupLabel: group.label } : {}),
    ...(sub ? { subtopic: sub.slug, subtopicLabel: sub.label } : {}),
    topCategories: topCategories(meta.categories),
    ...(sourcedDate(meta.categories) ? { date: sourcedDate(meta.categories) } : {}),
    ...(meta.assessment ? { assessment: meta.assessment } : {}),
    recentViews: meta.recentViews,
    score: {
      total: score.total,
      components: Object.fromEntries(
        Object.entries(score.components).map(([k, v]) => [k, Math.round(v * 100) / 100]),
      ) as Record<ScoreComponent, number>,
      signals: signals.slice(0, 4),
    },
    ...(candidate.relation ? { relation: candidate.relation } : {}),
  };
}
