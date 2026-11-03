import type { HoleEdge, HoleNode, RelationKind } from "@/lib/discovery/hole-types";
import { ArticleNode } from "./ArticleNode";
import styles from "./exploration.module.css";

const GROUPS: Array<{ kind: RelationKind; title: string; hint: string }> = [
  { kind: "direct", title: "Core concepts", hint: "Named in the submission, or linked from the main articles' introductions and sections." },
  { kind: "prerequisite", title: "Prerequisites", hint: "What the main articles are defined in terms of." },
  { kind: "historical", title: "History", hint: "Origins, influences, creators: from History sections and infoboxes." },
  { kind: "descendant", title: "Descendants", hint: "What came after: legacy sections and infobox successors." },
  { kind: "adjacent", title: "Adjacent", hint: "See also entries and articles Wikipedia finds textually similar, tied in by a link." },
];

/**
 * The articles of a rabbit hole grouped by how they relate, each with the
 * edge that introduced it (and therefore a sourced explanation).
 */
export function ArticleCollection({
  nodes,
  edges,
  selected,
  onSelect,
}: {
  nodes: HoleNode[];
  edges: HoleEdge[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const introducing = new Map(edges.filter((e) => e.structural).map((e) => [e.target, e]));
  const articles = nodes.filter((n) => n.level > 0 && n.role !== "primary");
  const groups = GROUPS.map((g) => ({
    ...g,
    items: articles.filter((n) => (n.role === "primary" ? "direct" : n.role) === g.kind).sort((a, b) => a.level - b.level || b.relevance - a.relevance),
  })).filter((g) => g.items.length > 0);

  if (groups.length === 0) return <p className={styles.muted}>No related articles at this depth.</p>;
  return (
    <div className={styles.collection}>
      {groups.map((group) => (
        <section key={group.kind} aria-labelledby={`group-${group.kind}`}>
          <div className={styles.groupHead}>
            <h3 id={`group-${group.kind}`} className="label">
              {group.title} · {group.items.length}
            </h3>
            <span className={styles.groupHint}>{group.hint}</span>
          </div>
          <ul className={styles.cards}>
            {group.items.map((node) => (
              <ArticleNode key={node.id} node={node} edge={introducing.get(node.id)} selected={selected === node.id} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
