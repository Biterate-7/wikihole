/**
 * The recommendation model. Built on the idea that what many people
 * independently recommend over years beats what a single viral thread pushes.
 * Pure functions, shared by the pipeline and tests; every input is a count that
 * can be traced to stored mentions.
 */

export interface QualifyingMention {
  discussionId: string;
  community: string;
  authorHash: string | null;
  /** Unix seconds. */
  at: number;
  /** Saying why it is worth reading counts fully; sharing it and being upvoted counts for less. */
  inWords?: boolean;
}

export interface EvidenceCounts {
  qualifying: number;
  discussions: number;
  recommenders: number;
  months: number;
  years: number;
  communities: number;
  firstAt: number;
  lastAt: number;
  recent12m: number;
  /** Independent weight after the caps below. */
  effective: number;
  /** Qualifying mentions where someone said so in words. */
  inWords: number;
}

const YEAR_SECONDS = 365.25 * 24 * 3600;

/** One thread cannot count for more than this, however many people pile in. */
export const DISCUSSION_CAP = 2;

/** A shared, upvoted link is a weaker signal than someone saying the article is worth reading. */
export const SHARED_WEIGHT = 0.5;

/**
 * Each person's k-th recommendation of an article counts 1/k, so one enthusiast
 * cannot manufacture consensus, and each discussion is capped, so one viral
 * thread cannot either.
 */
export function effectiveWeight(mentions: QualifyingMention[]): number {
  const byAuthor = new Map<string, number>();
  const byDiscussion = new Map<string, number>();
  for (const mention of [...mentions].sort((a, b) => a.at - b.at)) {
    let weight = mention.inWords === false ? SHARED_WEIGHT : 1;
    if (mention.authorHash) {
      const seen = (byAuthor.get(mention.authorHash) ?? 0) + 1;
      byAuthor.set(mention.authorHash, seen);
      weight /= seen;
    }
    byDiscussion.set(mention.discussionId, (byDiscussion.get(mention.discussionId) ?? 0) + weight);
  }
  let total = 0;
  for (const value of byDiscussion.values()) total += Math.min(DISCUSSION_CAP, value);
  return total;
}

export function countEvidence(mentions: QualifyingMention[], now: number): EvidenceCounts {
  const months = new Set<string>();
  const years = new Set<number>();
  for (const { at } of mentions) {
    const date = new Date(at * 1000);
    months.add(`${date.getUTCFullYear()}-${date.getUTCMonth()}`);
    years.add(date.getUTCFullYear());
  }
  const times = mentions.map((m) => m.at);
  return {
    qualifying: mentions.length,
    discussions: new Set(mentions.map((m) => m.discussionId)).size,
    recommenders: new Set(mentions.flatMap((m) => (m.authorHash ? [m.authorHash] : []))).size,
    months: months.size,
    years: years.size,
    communities: new Set(mentions.map((m) => m.community)).size,
    firstAt: Math.min(...times),
    lastAt: Math.max(...times),
    recent12m: times.filter((t) => now - t <= YEAR_SECONDS).length,
    effective: effectiveWeight(mentions),
    inWords: mentions.filter((m) => m.inWords !== false).length,
  };
}

const saturate = (value: number, scale: number) => 1 - Math.exp(-value / scale);

/** Below this share of recommendations among all mentions, an article is mostly cited, not recommended. */
export const FOCUS_SHARE = 0.15;

/**
 * 1 for an article people mostly bring up to recommend, falling to 0.6 for one
 * they mostly cite. This is what separates recommended from merely well known.
 */
export function focus(qualifying: number, otherMentions: number): number {
  const share = qualifying / Math.max(1, qualifying + otherMentions);
  return 0.6 + 0.4 * Math.min(1, share / FOCUS_SHARE);
}

/** 0 to 100. Independent people first, then persistence across months, years and communities, discounted when mostly cited. */
export function recommendationScore(counts: EvidenceCounts, otherMentions = 0): number {
  return (
    100 *
    focus(counts.qualifying, otherMentions) *
    (0.5 * saturate(counts.effective, 10) +
      0.25 * saturate(counts.months, 8) +
      0.15 * saturate(counts.years, 4) +
      0.1 * saturate(Math.max(0, counts.communities - 1), 1))
  );
}

export const COLLECTIONS = ["most", "hidden", "recent", "evergreen", "rising"] as const;
export type CollectionId = (typeof COLLECTIONS)[number];

export const HIDDEN_GEM_MAX_MONTHLY = 15000;
export const RECENT_DAYS = 180;

export interface CollectionInput extends EvidenceCounts {
  /** Mentions that did not qualify: citations, asides, criticism. */
  mentionsOther: number;
  /** Arrivals per month from the clickstream dump; null when below its reporting floor. */
  monthlyClicks: number | null;
  /** Whether the catalogue knows this page, so a null above really means low traffic. */
  inCatalogue: boolean;
  bytes: number | null;
}

/** Evidence a collection demands, and the order within it. Null means the article does not belong. */
export function collectionRank(id: CollectionId, a: CollectionInput, now: number): number | null {
  const score = recommendationScore(a, a.mentionsOther);
  switch (id) {
    case "most":
      return a.discussions >= 3 && a.recommenders >= 3 && a.months >= 3 ? score : null;
    case "hidden": {
      if (a.discussions < 2 || a.recommenders < 2 || !a.inCatalogue) return null;
      if ((a.monthlyClicks ?? 0) > HIDDEN_GEM_MAX_MONTHLY || (a.bytes ?? 0) < 4000) return null;
      return score - 6 * Math.log10(Math.max(10, a.monthlyClicks ?? 10));
    }
    case "recent":
      return now - a.lastAt <= RECENT_DAYS * 86400 ? a.lastAt : null;
    case "evergreen":
      return a.years >= 4 && a.months >= 5 && a.lastAt - a.firstAt >= 5 * YEAR_SECONDS ? score : null;
    case "rising": {
      if (a.recent12m < 2) return null;
      const priorYears = Math.max(1, (now - YEAR_SECONDS - a.firstAt) / YEAR_SECONDS);
      const priorRate = (a.qualifying - a.recent12m) / priorYears;
      return a.recent12m >= Math.max(2, 2 * priorRate) ? a.recent12m - priorRate + score / 100 : null;
    }
  }
}
