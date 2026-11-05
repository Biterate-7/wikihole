"use client";

import Link from "next/link";
import { Fragment, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS } from "@/components/hackernews/SubmissionCard";
import { SaveButton } from "@/components/ui/SaveButton";
import { ThumbImage } from "@/components/ui/ThumbImage";
import { LEVEL_LABELS, type Exploration, type ExplorationLevel, type HoleEdge, type HoleNode } from "@/lib/discovery/hole-types";
import { formatCount, formatRelative, leadSentences } from "@/lib/format";
import { articlePath } from "@/lib/wikipedia/titles";
import { ArticleCollection } from "./ArticleCollection";
import { KnowledgeGraph } from "./KnowledgeGraph";
import styles from "./exploration.module.css";

const LEVELS: ExplorationLevel[] = [1, 2, 3, 4];

function ArticleLinks({ titles }: { titles: string[] }) {
  return (
    <>
      {titles.map((title, i) => (
        <Fragment key={title}>
          {i > 0 ? (i === titles.length - 1 ? " and " : ", ") : null}
          <Link href={articlePath(title)}>{title}</Link>
        </Fragment>
      ))}
    </>
  );
}

function Outline({ nodes, depth }: { nodes: HoleNode[]; depth: number }) {
  const children = useMemo(() => {
    const map = new Map<string, HoleNode[]>();
    for (const n of nodes) {
      if (!n.parent || n.level > depth) continue;
      map.set(n.parent, [...(map.get(n.parent) ?? []), n]);
    }
    return map;
  }, [nodes, depth]);
  const render = (id: string): React.ReactNode => {
    const kids = children.get(id);
    if (!kids?.length) return null;
    return (
      <ul>
        {kids.map((n) => (
          <li key={n.id}>
            <Link href={articlePath(n.title)}>{n.title}</Link>
            <span className={styles.treeRole}> ({n.role === "primary" ? "main article" : n.role})</span>
            {render(n.id)}
          </li>
        ))}
      </ul>
    );
  };
  return (
    <div className={styles.tree} data-testid="hole-outline">
      {render("root")}
    </div>
  );
}

/**
 * The body of a rabbit-hole page: the source submission, a grounded summary,
 * the primary article, the knowledge graph with its depth control, a map of
 * the hole and the related articles. The page title and the static panels
 * (extraction, quality, sources) live in the surrounding page frame.
 */
export function SubmissionExplorer({ exploration, status }: { exploration: Exploration; status: "complete" | "insufficient" }) {
  const { submission, summary, nodes, edges, quality } = exploration;
  const primary = nodes.find((n) => n.role === "primary");
  const [depth, setDepth] = useState<ExplorationLevel>(2);
  // Nothing is focused at first, so the whole graph is visible; the detail panel starts on the main article.
  const [selected, setSelected] = useState<string | null>(null);
  const graphRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => nodes.filter((n) => n.level <= depth), [nodes, depth]);
  const counts = useMemo(() => LEVELS.map((l) => nodes.filter((n) => n.level === l).length), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = selected ? byId.get(selected) : primary;
  const selectedEdges: HoleEdge[] = selectedNode ? edges.filter((e) => e.target === selectedNode.id || e.source === selectedNode.id) : [];
  const beyond = nodes.filter((n) => n.level > depth).sort((a, b) => a.level - b.level || b.relevance - a.relevance).slice(0, 5);
  const articleCount = nodes.filter((n) => n.level > 0).length;

  const select = (id: string, scroll = false) => {
    setSelected(id);
    const node = byId.get(id);
    if (node && node.level > depth) setDepth(node.level as ExplorationLevel);
    if (scroll) graphRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <div className={styles.page}>
      <div className={styles.source} data-testid="hn-source">
        <p className={styles.sourceLine}>
          From Hacker News, {CATEGORY_LABELS[submission.category]}
          {summary.disciplines.length ? ` · ${summary.disciplines.map((d) => d.label).join(" · ")}` : ""}
        </p>
        <div className={styles.sourceMeta}>
          <span>{formatCount(submission.score)} points</span>
          <span className="dot">{formatCount(submission.comments)} comments</span>
          <span className="dot">by {submission.author}</span>
          <span className="dot" suppressHydrationWarning>
            {formatRelative(submission.time)}
          </span>
          <span className="dot">{articleCount} Wikipedia articles</span>
        </div>
        <div className={styles.sourceLinks}>
          {submission.url ? (
            <>
              <a className="action" href={submission.url} target="_blank" rel="noopener noreferrer">
                Original article{submission.domain ? ` (${submission.domain})` : ""}
              </a>
              <span className="dot" aria-hidden="true" />
            </>
          ) : null}
          <a className="action" href={submission.hnUrl} target="_blank" rel="noopener noreferrer">
            Discussion on Hacker News
          </a>
          <span className="dot" aria-hidden="true" />
          <Link className="action" href="/hackernews">
            All rabbit holes
          </Link>
        </div>
        {submission.text ? <blockquote className={styles.sourceText}>{leadSentences(submission.text, 600)}</blockquote> : null}
        {status === "insufficient" ? (
          <div className={styles.notice} role="status">
            This submission did not produce a strong enough rabbit hole to appear in the feed (quality {quality.score}).
            {quality.notes.length ? (
              <ul>
                {quality.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {summary.primary ? (
        <section aria-labelledby="about-heading">
          <h2 id="about-heading" className={styles.h2}>
            What this is about
          </h2>
          <div className={styles.prose} data-testid="hole-summary">
            <p>
              The submission is mainly about <Link href={articlePath(summary.primary.title)}>{summary.primary.title}</Link>
              {summary.primary.description ? `, ${summary.primary.description.charAt(0).toLowerCase()}${summary.primary.description.slice(1)}` : ""}.
              {summary.secondary.length ? (
                <>
                  {" "}
                  It also involves <ArticleLinks titles={summary.secondary.slice(0, 4)} />.
                </>
              ) : null}
            </p>
            {summary.primary.lead ? (
              <>
                <blockquote className={styles.quote}>{leadSentences(summary.primary.lead, 420)}</blockquote>
                <p className={styles.attribution}>From Wikipedia: {summary.primary.title}</p>
              </>
            ) : null}
            {summary.prerequisites.length ? (
              <p>
                Background that helps: <ArticleLinks titles={summary.prerequisites.slice(0, 4)} />.
              </p>
            ) : null}
            {summary.historical.length || summary.descendants.length ? (
              <p>
                {summary.historical.length ? (
                  <>
                    Its history runs through <ArticleLinks titles={summary.historical.slice(0, 3)} />.
                  </>
                ) : null}
                {summary.descendants.length ? (
                  <>
                    {" "}
                    It leads on to <ArticleLinks titles={summary.descendants.slice(0, 3)} />.
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {primary ? (
        <section aria-labelledby="primary-heading">
          <h2 id="primary-heading" className={styles.h2}>
            Primary article
          </h2>
          <article className={styles.primary} data-testid="primary-article">
            {primary.thumbnail ? (
              <div className={styles.primaryThumb}>
                <ThumbImage thumbnail={primary.thumbnail} size={120} />
              </div>
            ) : null}
            <p className={styles.primaryLabel}>
              Named in the submission as {(primary.mentionedAs ?? []).map((m) => `“${m}”`).join(", ")} · match confidence{" "}
              {Math.round((primary.confidence ?? 0) * 100)}%
            </p>
            <h3 className={styles.primaryTitle}>
              <Link href={articlePath(primary.title)}>{primary.title}</Link>
            </h3>
            {primary.description ? <p className={styles.primaryDesc}>{primary.description}</p> : null}
            {primary.extract ? <p className={styles.primaryExtract}>{leadSentences(primary.extract, 520)}</p> : null}
            <div className={styles.primaryActions}>
              <Link className="btn btn-primary" href={articlePath(primary.title)}>
                Read in WikiHole
              </Link>
              <SaveButton
                variant="button"
                article={{
                  title: primary.title,
                  description: primary.description,
                  extract: primary.extract ? leadSentences(primary.extract, 300) : undefined,
                  thumbnail: primary.thumbnail,
                  readingMinutes: primary.readingMinutes,
                }}
              />
            </div>
          </article>
        </section>
      ) : null}

      <section aria-labelledby="graph-heading" ref={graphRef}>
        <h2 id="graph-heading" className={styles.h2}>
          Knowledge graph
        </h2>
        <div className={styles.depth} role="group" aria-label="Exploration depth">
          <span className={styles.depthLabel}>Depth:</span>
          <ul className={styles.toggleList}>
            {LEVELS.map((level, i) => (
              <li key={level}>
                <button
                  type="button"
                  className={styles.toggle}
                  aria-pressed={depth === level}
                  disabled={counts[i] === 0 && level !== 1}
                  title={`${LEVEL_LABELS[level]} (${counts[i]})`}
                  onClick={() => setDepth(level)}
                >
                  {level}
                </button>
              </li>
            ))}
          </ul>
          <span className={styles.depthHint}>
            {LEVEL_LABELS[depth]}: showing {visible.length - 1} of {articleCount} articles
          </span>
        </div>
        <KnowledgeGraph nodes={nodes} edges={edges} depth={depth} selected={selected} onSelect={(id) => select(id)} />
        {selectedNode ? (
          <div className={styles.detail} aria-live="polite" data-testid="graph-detail">
            {selectedNode.level === 0 ? (
              <>
                <p className={styles.detailKicker}>Submission</p>
                <p className={styles.detailTitle}>{selectedNode.title}</p>
                <p>The starting point. Every level-1 article is named in it.</p>
              </>
            ) : (
              <>
                <p className={styles.detailKicker}>
                  Level {selectedNode.level} · {selectedNode.role === "primary" ? "main article" : selectedNode.role}
                </p>
                <h3 className={styles.detailTitle}>
                  <Link href={articlePath(selectedNode.title)}>{selectedNode.title}</Link>
                </h3>
                {selectedNode.description ? <p className={styles.detailDesc}>{selectedNode.description}</p> : null}
                <ul className={styles.detailList}>
                  {selectedEdges.slice(0, 6).map((e) => (
                    <li key={e.id}>{e.explanation}</li>
                  ))}
                </ul>
                <div className={styles.detailActions}>
                  <Link className="action" href={articlePath(selectedNode.title)}>
                    Read
                  </Link>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="map-heading">
        <h2 id="map-heading" className={styles.h2}>
          Map of the rabbit hole
        </h2>
        <Outline nodes={nodes} depth={depth} />
        {beyond.length || primary ? (
          <div className={styles.further}>
            <p className={styles.furtherHead}>Go further</p>
            <ul>
              {beyond.map((n) => (
                <li key={n.id}>
                  <Link href={articlePath(n.title)}>{n.title}</Link>{" "}
                  <button type="button" className="action" onClick={() => select(n.id, true)}>
                    (show at level {n.level})
                  </button>
                </li>
              ))}
              {primary ? (
                <li>
                  Continue from <Link href={`${articlePath(primary.title)}#rabbit-hole`}>{primary.title}</Link> in the reader&rsquo;s
                  Rabbit Hole
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="related-heading">
        <h2 id="related-heading" className={styles.h2}>
          Related articles
        </h2>
        <ArticleCollection nodes={visible} edges={edges} selected={selected} onSelect={(id) => select(id, true)} />
      </section>
    </div>
  );
}
