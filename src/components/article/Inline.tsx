import Link from "next/link";
import type { Inline } from "@/lib/content/types";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./article.module.css";

/** Renders WikiHole's inline content model. */
export function InlineContent({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((node, i) => renderInline(node, i))}</>;
}

export function MathView({ html, tex, display }: { html?: string; tex: string; display: boolean }) {
  if (!html) {
    return display ? (
      <pre className={styles.texFallback} aria-label="Equation (TeX source)">
        <code>{tex}</code>
      </pre>
    ) : (
      <code className={styles.texInline}>{tex}</code>
    );
  }
  // KaTeX output is generated server-side by us from TeX source with trust disabled.
  return display ? (
    <div className={styles.mathDisplay} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className={styles.mathInline} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function renderInline(node: Inline, key: number): React.ReactNode {
  switch (node.k) {
    case "text":
      return node.v;
    case "br":
      return <br key={key} />;
    case "em":
      return (
        <em key={key}>
          <InlineContent nodes={node.c} />
        </em>
      );
    case "strong":
      return (
        <strong key={key}>
          <InlineContent nodes={node.c} />
        </strong>
      );
    case "sub":
      return (
        <sub key={key}>
          <InlineContent nodes={node.c} />
        </sub>
      );
    case "sup":
      return (
        <sup key={key}>
          <InlineContent nodes={node.c} />
        </sup>
      );
    case "code":
      return (
        <code key={key} className={styles.code}>
          <InlineContent nodes={node.c} />
        </code>
      );
    case "small":
      return (
        <small key={key}>
          <InlineContent nodes={node.c} />
        </small>
      );
    case "s":
      return (
        <s key={key}>
          <InlineContent nodes={node.c} />
        </s>
      );
    case "link":
      return (
        <Link key={key} href={articlePath(node.to, node.fragment)} prefetch={false} className={styles.wikiLink} data-wiki-link>
          <InlineContent nodes={node.c} />
        </Link>
      );
    case "anchor":
      return (
        <a key={key} href={`#${node.target}`} className={styles.anchor}>
          <InlineContent nodes={node.c} />
        </a>
      );
    case "ext":
      return (
        <a key={key} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className={styles.extLink}>
          <InlineContent nodes={node.c} />
        </a>
      );
    case "math":
      return <MathView key={key} html={node.html} tex={node.tex} display={false} />;
    case "cite":
      return (
        <sup key={key} className={styles.cite}>
          <a href={`#${node.target}`} aria-label={`Reference ${node.label}`}>
            {node.label}
          </a>
        </sup>
      );
    case "target":
      return (
        <span key={key} id={node.id}>
          <InlineContent nodes={node.c} />
        </span>
      );
  }
}
