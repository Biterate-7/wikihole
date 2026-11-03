import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { SaveButton } from "@/components/ui/SaveButton";
import type { HoleEdge, HoleNode } from "@/lib/discovery/hole-types";
import { leadSentences } from "@/lib/format";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./exploration.module.css";

/** A Wikipedia article in a rabbit hole, with the sourced reason it is there. */
export function ArticleNode({ node, edge, selected, onSelect }: { node: HoleNode; edge?: HoleEdge; selected?: boolean; onSelect?: (id: string) => void }) {
  return (
    <li className={styles.card} data-testid="hole-article" data-title={node.title} data-selected={selected ?? false}>
      <p className={`label ${styles.relation}`}>
        <span>{edge?.label ?? "Related"}</span>
        {node.level > 0 ? <span>Level {node.level}</span> : null}
      </p>
      <h3 className={styles.cardTitle}>
        <Link href={articlePath(node.title)}>{node.title}</Link>
      </h3>
      {node.description ? <p className={styles.cardDesc}>{node.description}</p> : null}
      {edge ? <p className={styles.why}>{edge.explanation}</p> : null}
      {node.extract ? <p className={styles.cardExtract}>{leadSentences(node.extract, 240)}</p> : null}
      <div className={styles.cardMeta}>
        {node.readingMinutes ? <span className="label">{node.readingMinutes} min</span> : null}
        <SaveButton
          article={{
            title: node.title,
            description: node.description,
            extract: node.extract ? leadSentences(node.extract, 300) : undefined,
            thumbnail: node.thumbnail,
            readingMinutes: node.readingMinutes,
          }}
        />
        {node.url ? (
          <a className="action" href={node.url} target="_blank" rel="noopener noreferrer" aria-label={`${node.title} on Wikipedia (opens in new tab)`}>
            Wikipedia <Icon name="arrow-up-right" size={10} />
          </a>
        ) : null}
        {onSelect ? (
          <button type="button" className="action" onClick={() => onSelect(node.id)} aria-label={`Show ${node.title} in the graph`}>
            In graph
          </button>
        ) : null}
      </div>
    </li>
  );
}
