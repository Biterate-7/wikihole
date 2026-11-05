import type { EvidenceKind, LinkEvidence } from "@/lib/wikipedia/extraction";
import { INFOBOX_DESCENDANT, INFOBOX_FOUNDATION, INFOBOX_HISTORICAL } from "@/lib/wikipedia/extraction";
import type { LinkPair } from "@/lib/wikipedia/api";
import type { EdgeEvidence, ExplorationLevel, HoleEdge, RelationKind } from "./hole-types";

/**
 * Turns source evidence into typed, explained relations. A relation exists
 * only when there is a concrete place in Wikipedia that backs it: a link in
 * an article's defining sentence, introduction, infobox or a named section,
 * a See also entry, or a link between two articles in the graph. The
 * explanation always names that place, so nothing is asserted without a
 * source.
 */

export interface Relation {
  kind: RelationKind;
  label: string;
  explanation: string;
  evidence: EdgeEvidence;
  detail?: string;
  /** How strongly the evidence ties the two articles, 0..1. */
  strength: number;
  /** Exploration level the target belongs to when introduced through this relation. */
  level: Exclude<ExplorationLevel, 1>;
}

const q = (title: string) => `“${title}”`;

export function relationFromEvidence(source: string, evidence: LinkEvidence): Relation {
  const target = evidence.title;
  const detail = evidence.detail;
  const at = <T extends object>(r: T) => ({ ...r, evidence: evidence.kind as EvidenceKind, ...(detail ? { detail } : {}) });
  switch (evidence.kind) {
    case "definition":
      return at({
        kind: "prerequisite",
        label: "Prerequisite",
        explanation: `${q(source)} is defined in terms of ${q(target)} in the opening sentence of its article.`,
        strength: 1 - Math.min(0.2, evidence.position * 0.04),
        level: 2,
      });
    case "lead":
      return at({
        kind: "direct",
        label: "Core concept",
        explanation: `${q(target)} is linked from the introduction of ${q(source)}.`,
        strength: 0.82 - Math.min(0.3, evidence.position * 0.02),
        level: 2,
      });
    case "infobox":
      if (detail && INFOBOX_HISTORICAL.test(detail)) {
        return at({
          kind: "historical",
          label: detail,
          explanation: `${q(target)} is listed under “${detail}” in the infobox of ${q(source)}.`,
          strength: 0.86,
          level: 3,
        });
      }
      if (detail && INFOBOX_DESCENDANT.test(detail)) {
        return at({
          kind: "descendant",
          label: detail,
          explanation: `${q(target)} is listed under “${detail}” in the infobox of ${q(source)}.`,
          strength: 0.86,
          level: 3,
        });
      }
      if (detail && INFOBOX_FOUNDATION.test(detail)) {
        return at({
          kind: "prerequisite",
          label: detail,
          explanation: `${q(source)} lists ${q(target)} under “${detail}” in its infobox.`,
          strength: 0.78,
          level: 2,
        });
      }
      return at({
        kind: "direct",
        label: detail ?? "Infobox",
        explanation: `${q(target)} appears under “${detail ?? "details"}” in the infobox of ${q(source)}.`,
        strength: 0.55,
        level: 3,
      });
    case "history-section":
      return at({
        kind: "historical",
        label: "History",
        explanation: `${q(target)} is linked in the “${detail ?? "History"}” section of ${q(source)}.`,
        strength: 0.72 - Math.min(0.25, evidence.position * 0.015),
        level: 3,
      });
    case "legacy-section":
      return at({
        kind: "descendant",
        label: "Legacy",
        explanation: `${q(target)} is linked in the “${detail ?? "Legacy"}” section of ${q(source)}.`,
        strength: 0.7 - Math.min(0.25, evidence.position * 0.015),
        level: 3,
      });
    case "usage-section":
      return at({
        kind: "direct",
        label: "Application",
        explanation: `${q(target)} is linked in the “${detail ?? "Applications"}” section of ${q(source)}.`,
        strength: 0.5 - Math.min(0.25, evidence.position * 0.015),
        level: 3,
      });
    case "see-also":
      return at({
        kind: "adjacent",
        label: "See also",
        explanation: `${q(target)} is listed under See also in ${q(source)}.`,
        strength: 0.62,
        level: 3,
      });
    case "section":
    default:
      return at({
        kind: "direct",
        label: "Technical detail",
        explanation: `${q(target)} is discussed in the “${detail ?? "body"}” section of ${q(source)}.`,
        strength: 0.48 - Math.min(0.25, evidence.position * 0.01),
        level: 3,
      });
  }
}

/** The strongest relation among several pieces of evidence for the same target. */
export function strongestRelation(source: string, evidence: LinkEvidence[]): Relation | null {
  let best: Relation | null = null;
  for (const item of evidence) {
    const relation = relationFromEvidence(source, item);
    if (!best || relation.strength > best.strength) best = relation;
  }
  return best;
}

export function edgeId(source: string, target: string, kind: string): string {
  return `${source}>${target}:${kind}`;
}

/**
 * Edges from the link matrix between graph articles. Pairs already joined by
 * an explained edge (in either direction) are skipped; reciprocal links
 * become one edge.
 */
export function linkEdges(
  pairs: LinkPair[],
  idByTitle: Map<string, string>,
  existing: HoleEdge[],
  { max = 60 }: { max?: number } = {},
): HoleEdge[] {
  const joined = new Set(existing.flatMap((e) => [`${e.source}|${e.target}`, `${e.target}|${e.source}`]));
  const forward = new Set(pairs.map((p) => `${p.from}|${p.to}`));
  const out: HoleEdge[] = [];
  for (const { from, to } of pairs) {
    const source = idByTitle.get(from);
    const target = idByTitle.get(to);
    if (!source || !target || source === target || joined.has(`${source}|${target}`)) continue;
    const mutual = forward.has(`${to}|${from}`);
    joined.add(`${source}|${target}`);
    joined.add(`${target}|${source}`);
    out.push({
      id: edgeId(source, target, "link"),
      source,
      target,
      kind: "direct",
      label: mutual ? "Linked both ways" : "Links to",
      explanation: mutual ? `${q(from)} and ${q(to)} link to each other on Wikipedia.` : `${q(from)} links to ${q(to)} on Wikipedia.`,
      evidence: "link",
      structural: false,
    });
    if (out.length >= max) break;
  }
  return out;
}
