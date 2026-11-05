"use client";

import { useMemo, useState } from "react";
import { layoutGraph, truncateLabel } from "@/lib/discovery/graph-layout";
import { RELATION_KINDS, RELATION_LABELS, type HoleEdge, type HoleNode, type RelationKind } from "@/lib/discovery/hole-types";
import styles from "./exploration.module.css";

const RADIUS: Record<number, number> = { 0: 9, 1: 6.5, 2: 5, 3: 4, 4: 4 };

interface Props {
  nodes: HoleNode[];
  edges: HoleEdge[];
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
}

/**
 * Interactive radial knowledge graph. Hovering or focusing a node highlights
 * its relations; selecting it (click, Enter or Space) shows its details.
 * Edge dash patterns encode the relation kind (see the legend).
 */
export function KnowledgeGraph({ nodes, edges, depth, selected, onSelect }: Props) {
  const layout = useMemo(() => layoutGraph(nodes, edges, depth), [nodes, edges, depth]);
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = hovered ?? selected;
  const position = useMemo(() => new Map(layout.nodes.map((p) => [p.node.id, p])), [layout]);

  const active = useMemo(() => {
    if (!focus) return null;
    const ids = new Set([focus]);
    const edgeIds = new Set<string>();
    for (const e of layout.edges) {
      if (e.source === focus || e.target === focus) {
        ids.add(e.source);
        ids.add(e.target);
        edgeIds.add(e.id);
      }
    }
    return { ids, edgeIds };
  }, [focus, layout]);

  const { x, y, width, height } = layout.viewBox;
  const structural = layout.edges.filter((e) => e.structural);
  const cross = layout.edges.filter((e) => !e.structural);

  return (
    <div>
      <div className={styles.graphFrame}>
        <svg
          className={styles.graph}
          viewBox={`${x} ${y} ${width} ${height}`}
          role="group"
          aria-label={`Knowledge graph: ${layout.nodes.length - 1} Wikipedia articles and ${layout.edges.length} relations`}
          data-focus={Boolean(active)}
          data-testid="knowledge-graph"
        >
          <g>
            {cross.map((e) => {
              const a = position.get(e.source);
              const b = position.get(e.target);
              if (!a || !b) return null;
              // Cross-links bow towards the centre so they read apart from the tree's spokes.
              const cx = ((a.x + b.x) / 2) * 0.55;
              const cy = ((a.y + b.y) / 2) * 0.55;
              return (
                <path
                  key={e.id}
                  d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}
                  className={`${styles.edge} ${styles.edgeCross}`}
                  data-kind={e.kind}
                  data-active={active?.edgeIds.has(e.id) ?? false}
                />
              );
            })}
            {structural.map((e) => {
              const a = position.get(e.source);
              const b = position.get(e.target);
              if (!a || !b) return null;
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={styles.edge}
                  data-kind={e.kind}
                  data-active={active?.edgeIds.has(e.id) ?? false}
                />
              );
            })}
          </g>
          <g>
            {layout.nodes.map(({ node, x: nx, y: ny, angle }) => {
              const r = RADIUS[node.level] ?? 4;
              const right = Math.cos(angle) >= -0.01;
              const label = node.level === 0 ? "Submission" : truncateLabel(node.title);
              return (
                <g
                  key={node.id}
                  className={styles.node}
                  data-level={node.level}
                  data-role={node.role}
                  data-active={active?.ids.has(node.id) ?? false}
                  data-selected={selected === node.id}
                  data-testid="graph-node"
                  role="button"
                  tabIndex={0}
                  aria-label={node.level === 0 ? `Submission: ${node.title}` : `${node.title}, level ${node.level}, ${node.role}`}
                  aria-pressed={selected === node.id}
                  onClick={() => onSelect(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(node.id);
                    }
                  }}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(node.id)}
                  onBlur={() => setHovered(null)}
                >
                  <title>{node.title}</title>
                  {/* Generous invisible hit area for touch. */}
                  <circle cx={nx} cy={ny} r={Math.max(r + 5, 10)} fill="transparent" stroke="none" style={{ fill: "transparent", stroke: "none" }} />
                  <circle cx={nx} cy={ny} r={r} />
                  {node.level === 0 ? (
                    <text x={nx} y={ny + r + 15} textAnchor="middle">
                      {label}
                    </text>
                  ) : (
                    <text x={right ? nx + r + 6 : nx - r - 6} y={ny + 4} textAnchor={right ? "start" : "end"}>
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <GraphLegend />
    </div>
  );
}

const DASH: Record<RelationKind, string | undefined> = {
  direct: undefined,
  prerequisite: "5 3",
  historical: "1.5 3",
  descendant: "9 3 2 3",
  adjacent: "2 5",
};

export function GraphLegend() {
  return (
    <ul className={styles.legend} aria-label="Relation types">
      {RELATION_KINDS.map((kind) => (
        <li key={kind}>
          <svg width="26" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" strokeWidth="1.2" strokeDasharray={DASH[kind]} />
          </svg>
          {RELATION_LABELS[kind]}
        </li>
      ))}
      <li>
        <svg width="26" height="10" aria-hidden="true">
          <path d="M0,8 Q13,-2 26,8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
        </svg>
        Wikipedia link
      </li>
    </ul>
  );
}
