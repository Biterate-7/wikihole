import type { HoleEdge, HoleNode } from "./hole-types";

/**
 * Deterministic radial layout for a rabbit hole: the submission sits at the
 * centre, each exploration level on its own ring, and every node inside the
 * angular sector of the node that introduced it, so the picture reads as the
 * tree it is. Sectors are sized by the number of visible leaves beneath each
 * node. Pure function, shared by the server render and the client.
 */

export interface PositionedNode {
  node: HoleNode;
  x: number;
  y: number;
  /** Angle in radians (0 = right, clockwise in screen space). */
  angle: number;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: HoleEdge[];
  /** SVG viewBox fitted to nodes and their labels. */
  viewBox: { x: number; y: number; width: number; height: number };
}

export const RING_RADII = [0, 150, 270, 370, 455] as const;
/** Approximate label width per character at the graph's label size. */
const CHAR_WIDTH = 6.2;
export const LABEL_MAX_CHARS = 26;

export function truncateLabel(title: string, max = LABEL_MAX_CHARS): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

export function layoutGraph(nodes: HoleNode[], edges: HoleEdge[], depth: number): GraphLayout {
  const visible = nodes.filter((n) => n.level <= depth);
  const ids = new Set(visible.map((n) => n.id));
  const children = new Map<string, HoleNode[]>();
  for (const node of visible) {
    if (!node.parent || !ids.has(node.parent)) continue;
    children.set(node.parent, [...(children.get(node.parent) ?? []), node]);
  }
  // Orphans (parent hidden or missing) hang from the root so nothing disappears.
  const root = visible.find((n) => n.level === 0);
  if (root) {
    for (const node of visible) {
      if (node === root || (node.parent && ids.has(node.parent))) continue;
      children.set(root.id, [...(children.get(root.id) ?? []), node]);
    }
  }

  const leaves = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = children.get(id) ?? [];
    const n = kids.length === 0 ? 1 : kids.reduce((s, k) => s + countLeaves(k.id), 0);
    leaves.set(id, n);
    return n;
  };
  if (root) countLeaves(root.id);

  const positioned: PositionedNode[] = [];
  const place = (node: HoleNode, start: number, end: number) => {
    const angle = (start + end) / 2;
    const radius = RING_RADII[node.level] ?? RING_RADII[RING_RADII.length - 1];
    positioned.push({ node, angle, x: Math.round(Math.cos(angle) * radius * 10) / 10, y: Math.round(Math.sin(angle) * radius * 10) / 10 });
    const kids = [...(children.get(node.id) ?? [])].sort((a, b) => b.relevance - a.relevance);
    // Alternate strong and weak children so heavy branches do not bunch on one side.
    const ordered: HoleNode[] = [];
    for (let lo = 0, hi = kids.length - 1; lo <= hi; lo++, hi--) {
      ordered.push(kids[lo]);
      if (hi !== lo) ordered.push(kids[hi]);
    }
    const total = ordered.reduce((s, k) => s + (leaves.get(k.id) ?? 1), 0) || 1;
    let cursor = start;
    for (const kid of ordered) {
      const span = ((end - start) * (leaves.get(kid.id) ?? 1)) / total;
      place(kid, cursor, cursor + span);
      cursor += span;
    }
  };
  if (root) place(root, -Math.PI / 2, (3 * Math.PI) / 2);

  let minX = -60;
  let maxX = 60;
  let minY = -40;
  let maxY = 40;
  for (const p of positioned) {
    const label = p.node.level === 0 ? 0 : truncateLabel(p.node.title).length * CHAR_WIDTH + 14;
    const right = Math.cos(p.angle) >= 0;
    minX = Math.min(minX, p.x - (right ? 12 : label));
    maxX = Math.max(maxX, p.x + (right ? label : 12));
    minY = Math.min(minY, p.y - 18);
    maxY = Math.max(maxY, p.y + 18);
  }
  const pad = 12;
  return {
    nodes: positioned,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    viewBox: { x: Math.floor(minX - pad), y: Math.floor(minY - pad), width: Math.ceil(maxX - minX + 2 * pad), height: Math.ceil(maxY - minY + 2 * pad) },
  };
}
