/** Routes of the Unexpected Connections pages. */

export const CONNECTIONS_PATH = "/connections";

/** Trails that start from an article. */
export function trailsFromPath(title: string): string {
  return `${CONNECTIONS_PATH}?from=${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

/** One curated trail. */
export function trailPath(id: string): string {
  return `${CONNECTIONS_PATH}?trail=${encodeURIComponent(id)}`;
}
