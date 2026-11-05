import Link from "next/link";
import { SaveButton } from "@/components/ui/SaveButton";
import type { HoleEdge, HoleNode } from "@/lib/discovery/hole-types";
import { leadSentences } from "@/lib/format";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./exploration.module.css";

/** A Wikipedia article in a rabbit hole, with the sourced reason it is there. */
export function ArticleNode({ node, edge, selected, onSelect }: { node: HoleNode; edge?: HoleEdge; selected?: boolean; onSelect?: (id: string) => void }) {
  return (
    <li className={styles.card} data-testid="hole-article" data-title={node.title} data-selected={selected ?? false}>
      <h4 className={styles.cardTitle}>
        <Link href={articlePath(node.title)}>{node.title}</Link>
      </h4>
      <p className={styles.relation}>
        {edge?.label ?? "Related"}
        {node.level > 0 ? ` · level ${node.level}` : ""}
      </p>
      {node.description ? <p className={styles.cardDesc}>{node.description}</p> : null}
      {edge ? <p className={styles.why}>{edge.explanation}</p> : null}
      {node.extract ? <p className={styles.cardExtract}>{leadSentences(node.extract, 240)}</p> : null}
      <div className={styles.cardMeta}>
        {node.readingMinutes ? (
          <>
            <span>{node.readingMinutes} min read</span>
            <span className="dot" aria-hidden="true" />
          </>
        ) : null}
        <SaveButton
          article={{
            title: node.title,
            description: node.description,
            extract: node.extract ? leadSentences(node.extract, 300) : undefined,
            thumbnail: node.thumbnail,
            readingMinutes: node.readingMinutes,
          }}
        />
        {onSelect ? (
          <>
            <span className="dot" aria-hidden="true" />
            <button type="button" className="action" onClick={() => onSelect(node.id)} aria-label={`Show ${node.title} in the graph`}>
              In graph
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}
