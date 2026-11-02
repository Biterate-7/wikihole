import { combine, toDiscovery, type Candidate, type Features } from "./score";
import type { Discovery, Weights } from "./types";

/**
 * Greedy, diversity-aware selection (in the spirit of maximal marginal
 * relevance). Each pick rewards candidates from clusters not yet shown, so a
 * batch never collapses onto a single subject. Optional Gaussian noise keeps
 * successive batches from being identical while preserving the ranking signal.
 */

export interface Scored {
  candidate: Candidate;
  features: Features;
}

function gaussian(random: () => number): number {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function clusterKey(s: Scored): string {
  return s.candidate.subtopic ?? s.features.group ?? s.candidate.meta.categories[0] ?? "misc";
}

export function groupKey(s: Scored): string {
  return s.features.group ?? "none";
}

export interface SelectOptions {
  limit: number;
  noise?: number;
  random?: () => number;
  /**
   * Hard cap on items from one cluster. The soft diversity term alone cannot
   * overcome large base-score gaps; the cap guarantees a mixed batch. It is
   * relaxed only when no candidate from another cluster remains.
   */
  maxPerCluster?: number;
}

export function selectDiverse(items: Scored[], weights: Weights, options: SelectOptions): Discovery[] {
  const random = options.random ?? Math.random;
  const noise = options.noise ?? 0;
  const pool = items.map((item) => ({
    item,
    jitter: noise ? gaussian(random) * noise : 0,
    base: combine(item.features, item.candidate.exploration, 0, weights).total,
  }));
  const clusterCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  const picked: Discovery[] = [];

  const cap = options.maxPerCluster ?? Infinity;
  while (picked.length < options.limit && pool.length > 0) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    let bestDiversity = 0;
    const capped = pool.every(({ item }) => (clusterCounts.get(clusterKey(item)) ?? 0) >= cap);
    for (let i = 0; i < pool.length; i++) {
      const { item, jitter, base } = pool[i];
      const sameCluster = clusterCounts.get(clusterKey(item)) ?? 0;
      if (!capped && sameCluster >= cap) continue;
      const sameGroup = groupCounts.get(groupKey(item)) ?? 0;
      const diversity = 1 / (1 + 0.9 * sameCluster + 0.3 * sameGroup);
      const value = base + 100 * weights.diversity * diversity * item.features.penalty + jitter;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
        bestDiversity = diversity;
      }
    }
    const [{ item }] = pool.splice(bestIndex, 1);
    const score = combine(item.features, item.candidate.exploration, bestDiversity, weights);
    picked.push(toDiscovery(item.candidate, item.features, score));
    clusterCounts.set(clusterKey(item), (clusterCounts.get(clusterKey(item)) ?? 0) + 1);
    groupCounts.set(groupKey(item), (groupCounts.get(groupKey(item)) ?? 0) + 1);
  }
  return picked;
}
