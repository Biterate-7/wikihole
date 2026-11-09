import { CURATED_TRAILS, FEATURED_TRAIL_ID } from "./curated";
import { titleKey } from "./key";
import type { TrailConnection, TrailDefinition } from "./types";

/**
 * The curated trails as a graph. A step written for one trail is a fact about
 * two articles, not about that trail, so a reader who starts part-way along
 * a trail (or where two trails meet) still follows only hand-written steps.
 */

/** A trail needs a start, at least one article in between, and a destination. */
export const MIN_STOPS = 3;
/** Longer trails stop feeling like one thought. */
export const MAX_STOPS = 6;

export { titleKey };

/** Structural problems with a trail; an empty list means it can be shown. */
export function trailProblems(trail: Pick<TrailDefinition, "titles" | "connections" | "payoff">): string[] {
  const problems: string[] = [];
  if (trail.titles.length < MIN_STOPS) problems.push(`needs at least ${MIN_STOPS} articles`);
  if (trail.titles.length > MAX_STOPS) problems.push(`has more than ${MAX_STOPS} articles`);
  if (trail.connections.length !== trail.titles.length - 1) problems.push("needs one connection between each pair of articles");
  const seen = new Set<string>();
  for (const title of trail.titles) {
    if (!title.trim()) problems.push("has an empty title");
    const key = titleKey(title);
    if (seen.has(key)) problems.push(`repeats “${title}”`);
    seen.add(key);
  }
  trail.connections.forEach((c, i) => {
    if (!c.summary.trim() || !c.detail.trim()) problems.push(`connection ${i + 1} has no explanation`);
  });
  if (!trail.payoff.trim()) problems.push("has no payoff");
  return problems;
}

interface Edge {
  to: string;
  connection: TrailConnection;
  trail: TrailDefinition;
}

interface Graph {
  edges: Map<string, Edge[]>;
  /** Destinations of the trails: a path is only offered if it ends somewhere surprising. */
  destinations: Set<string>;
  /** Display spelling of every title, by key. */
  names: Map<string, string>;
}

function buildGraph(trails: TrailDefinition[]): Graph {
  const edges = new Map<string, Edge[]>();
  const destinations = new Set<string>();
  const names = new Map<string, string>();
  for (const trail of trails) {
    trail.titles.forEach((title, i) => {
      names.set(titleKey(title), title);
      const next = trail.titles[i + 1];
      if (next === undefined) return;
      const from = titleKey(title);
      const list = edges.get(from) ?? [];
      // The first trail to describe a step owns its wording.
      if (!list.some((e) => titleKey(e.to) === titleKey(next))) list.push({ to: next, connection: trail.connections[i], trail });
      edges.set(from, list);
    });
    destinations.add(titleKey(trail.titles[trail.titles.length - 1]));
  }
  return { edges, destinations, names };
}

const defaultGraph = buildGraph(CURATED_TRAILS);

/** Every curated path that starts at `title` and ends at a curated destination, best first. */
export function trailsFrom(title: string, trails: TrailDefinition[] = CURATED_TRAILS): TrailDefinition[] {
  const graph = trails === CURATED_TRAILS ? defaultGraph : buildGraph(trails);
  const startKey = titleKey(title);
  const start = graph.names.get(startKey);
  if (!start) return [];

  const found: Array<{ titles: string[]; via: Edge[] }> = [];
  const walk = (titles: string[], via: Edge[]) => {
    const here = titleKey(titles[titles.length - 1]);
    if (titles.length >= MIN_STOPS && graph.destinations.has(here)) found.push({ titles, via });
    if (titles.length >= MAX_STOPS) return;
    for (const edge of graph.edges.get(here) ?? []) {
      if (titles.some((t) => titleKey(t) === titleKey(edge.to))) continue;
      walk([...titles, edge.to], [...via, edge]);
    }
  };
  walk([start], []);

  const whole = (path: { titles: string[] }) =>
    trails.find((t) => t.titles.length === path.titles.length && t.titles.every((x, i) => titleKey(x) === titleKey(path.titles[i])));
  const sources = (path: { via: Edge[] }) => new Set(path.via.map((e) => e.trail.id)).size;
  const ranked = found
    .map((path, order) => ({ path, order, curated: whole(path) }))
    .sort((a, b) => Number(!a.curated) - Number(!b.curated) || sources(a.path) - sources(b.path) || a.order - b.order);

  const seen = new Set<string>();
  const out: TrailDefinition[] = [];
  for (const { path, curated } of ranked) {
    const key = path.titles.map(titleKey).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    if (curated) {
      out.push(curated);
      continue;
    }
    const last = path.via[path.via.length - 1].trail;
    out.push({
      id: `${last.id}--from-${titleKey(start).replace(/[^\p{L}\p{N}]+/gu, "-")}`,
      origin: "curated",
      titles: path.titles,
      connections: path.via.map((e) => e.connection),
      payoff: last.payoff,
    });
  }
  return out;
}

export function curatedTrail(id: string): TrailDefinition | undefined {
  return CURATED_TRAILS.find((t) => t.id === id);
}

export function featuredTrail(): TrailDefinition {
  return curatedTrail(FEATURED_TRAIL_ID) ?? CURATED_TRAILS[0];
}

/** Curated trails with the featured one first. */
export function curatedTrailsFeaturedFirst(): TrailDefinition[] {
  const featured = featuredTrail();
  return [featured, ...CURATED_TRAILS.filter((t) => t !== featured)];
}
