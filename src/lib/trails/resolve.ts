import type { PageMeta } from "@/lib/wikipedia/types";
import { normalizeTitle } from "@/lib/wikipedia/titles";
import type { ResolvedTrail, TrailDefinition, TrailStop } from "./types";

/**
 * Joins a trail with Wikipedia's metadata for its articles. `metas` is keyed
 * by normalised title (as getPagesMetaMap returns it): a null value means
 * Wikipedia has no such article; a null map means the lookup itself failed,
 * and every card falls back to its title.
 */
export function resolveTrail(
  trail: TrailDefinition,
  metas: Map<string, PageMeta | null> | null,
  canStart: (title: string) => boolean = () => false,
): ResolvedTrail {
  const stops: TrailStop[] = trail.titles.map((title) => {
    const startable = canStart(title);
    if (!metas) return { title, status: "unknown", startable };
    const meta = metas.get(normalizeTitle(title));
    if (meta === undefined) return { title, status: "unknown", startable };
    if (meta === null) return { title, status: "missing", startable: false };
    return {
      title: meta.title,
      status: "ok",
      startable,
      ...(meta.description ? { description: meta.description } : {}),
      ...(meta.thumbnail ? { thumbnail: meta.thumbnail } : {}),
    };
  });
  return { id: trail.id, origin: trail.origin, connections: trail.connections, payoff: trail.payoff, stops };
}

/** Every distinct title across a set of trails, for one batched metadata request. */
export function trailTitles(trails: TrailDefinition[]): string[] {
  return [...new Set(trails.flatMap((t) => t.titles))];
}
