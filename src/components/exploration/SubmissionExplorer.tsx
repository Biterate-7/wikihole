"use client";

import Link from "next/link";
import { Fragment, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS } from "@/components/hackernews/SubmissionCard";
import { Icon } from "@/components/ui/Icon";
import { SaveButton } from "@/components/ui/SaveButton";
import { ThumbImage } from "@/components/ui/ThumbImage";
import {
  LEVEL_LABELS,
  QUALITY_COMPONENTS,
  type Exploration,
  type ExplorationLevel,
  type HoleEdge,
  type HoleNode,
} from "@/lib/discovery/hole-types";
import { formatCount, formatRelative, leadSentences } from "@/lib/format";
import { articlePath } from "@/lib/wikipedia/titles";
import { ArticleCollection } from "./ArticleCollection";
import { KnowledgeGraph } from "./KnowledgeGraph";
import styles from "./exploration.module.css";

const LEVELS: ExplorationLevel[] = [1, 2, 3, 4];

const QUALITY_LABELS: Record<(typeof QUALITY_COMPONENTS)[number], string> = {
  coverage: "Coverage",
  confidence: "Match confidence",
  depth: "Depth",
  connectivity: "Interlinking",
  articles: "Article quality",
  technical: "Technical",
};

const REASON_LABELS: Record<string, string> = {
  "no-article": "no matching article",
  "low-confidence": "no confident match",
  "disambiguation-only": "ambiguous name",
  "rejected-page": "not an article",
};

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

function Outline({ nodes, depth, rootTitle }: { nodes: HoleNode[]; depth: number; rootTitle: string }) {
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
            <span className={styles.treeItem}>
              <Link href={articlePath(n.title)}>{n.title}</Link>
              <span className="label">{n.role === "primary" ? "Main article" : n.role}</span>
            </span>
            {render(n.id)}
          </li>
        ))}
      </ul>
    );
  };
  return (
    <div className={styles.tree} data-testid="hole-outline">
      <span className={styles.treeRoot}>{rootTitle}</span>
      {render("root")}
    </div>
  );
}

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

  const select = (id: string, scroll = false) => {
    setSelected(id);
    const node = byId.get(id);
    if (node && node.level > depth) setDepth(node.level as ExplorationLevel);
    if (scroll) graphRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const articleCount = nodes.filter((n) => n.level > 0).length;

  return (
    <div className={styles.page}>
      <header className={styles.source} data-testid="hn-source">
        <p className="label">
          Hacker News · {CATEGORY_LABELS[submission.category]}
          {summary.disciplines.length ? ` · ${summary.disciplines.map((d) => d.label).join(" · ")}` : ""}
        </p>
        <h1 className={styles.sourceTitle}>{submission.title}</h1>
        <div className={styles.sourceMeta}>
          <span>{formatCount(submission.score)} points</span>
          <span className="dot">{formatCount(submission.comments)} comments</span>
          <span className="dot">by {submission.author}</span>
          <span className="dot" suppressHydrationWarning>
            {formatRelative(submission.time)}
          </span>
          {submission.domain ? <span className="dot">{submission.domain}</span> : null}
          <span className="dot">{articleCount} Wikipedia articles</span>
        </div>
        <div className={styles.sourceLinks}>
          {submission.url ? (
            <a className="btn" href={submission.url} target="_blank" rel="noopener noreferrer">
              Original article <Icon name="arrow-up-right" size={11} />
            </a>
          ) : null}
          <a className="btn" href={submission.hnUrl} target="_blank" rel="noopener noreferrer">
            Discussion on Hacker News <Icon name="arrow-up-right" size={11} />
          </a>
          <Link className="btn" href="/hackernews">
            All rabbit holes
          </Link>
        </div>
        {submission.text ? <p className={styles.sourceText}>{leadSentences(submission.text, 600)}</p> : null}
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
      </header>

      <div className={styles.grid}>
        <div className={styles.main}>
          {summary.primary ? (
            <section aria-labelledby="about-heading">
              <div className={styles.sectionHead}>
                <h2 id="about-heading" className={styles.sectionTitle}>
                  What this is about
                </h2>
              </div>
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
              <div className={styles.sectionHead}>
                <h2 id="primary-heading" className={styles.sectionTitle}>
                  Primary article
                </h2>
                <span className="label">Match confidence {Math.round((primary.confidence ?? 0) * 100)}%</span>
              </div>
              <article className={styles.primary} data-testid="primary-article">
                <div>
                  <p className="label">
                    Named in the submission as {(primary.mentionedAs ?? []).map((m) => `“${m}”`).join(", ")}
                  </p>
                  <h3 className={styles.primaryTitle}>
                    <Link href={articlePath(primary.title)}>{primary.title}</Link>
                  </h3>
                  {primary.description ? <p className={styles.primaryDesc}>{primary.description}</p> : null}
                  {primary.extract ? <p className={styles.primaryExtract}>{leadSentences(primary.extract, 520)}</p> : null}
                  <div className={styles.sourceLinks}>
                    <Link className="btn btn-primary" href={articlePath(primary.title)}>
                      Read in WikiHole <Icon name="arrow-right" size={11} />
                    </Link>
                    {primary.url ? (
                      <a className="btn" href={primary.url} target="_blank" rel="noopener noreferrer">
                        Wikipedia <Icon name="arrow-up-right" size={11} />
                      </a>
                    ) : null}
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
                </div>
                {primary.thumbnail ? (
                  <div className={styles.primaryThumb}>
                    <ThumbImage thumbnail={primary.thumbnail} size={120} />
                  </div>
                ) : null}
              </article>
            </section>
          ) : null}

          <section aria-labelledby="graph-heading" ref={graphRef}>
            <div className={styles.sectionHead}>
              <h2 id="graph-heading" className={styles.sectionTitle}>
                Knowledge graph
              </h2>
              <div className={styles.depth} role="group" aria-label="Exploration depth">
                <span className="label">Depth</span>
                {LEVELS.map((level, i) => (
                  <button
                    key={level}
                    type="button"
                    className="btn"
                    aria-pressed={depth === level}
                    disabled={counts[i] === 0 && level !== 1}
                    title={`${LEVEL_LABELS[level]} (${counts[i]})`}
                    onClick={() => setDepth(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
            <KnowledgeGraph nodes={nodes} edges={edges} depth={depth} selected={selected} onSelect={(id) => select(id)} />
            <p className={styles.depthHint}>
              Level {depth}: {LEVEL_LABELS[depth].toLowerCase()}. Showing {visible.length - 1} of {articleCount} articles.
            </p>
            {selectedNode ? (
              <div className={styles.detail} aria-live="polite" data-testid="graph-detail">
                {selectedNode.level === 0 ? (
                  <>
                    <p className="label">Submission</p>
                    <p className={styles.cardTitle}>{selectedNode.title}</p>
                    <p className={styles.why}>The starting point. Every level-1 article is named in it.</p>
                  </>
                ) : (
                  <>
                    <p className="label">
                      Level {selectedNode.level} · {selectedNode.role === "primary" ? "Main article" : selectedNode.role}
                    </p>
                    <h3 className={styles.cardTitle}>
                      <Link href={articlePath(selectedNode.title)}>{selectedNode.title}</Link>
                    </h3>
                    {selectedNode.description ? <p className={styles.cardDesc}>{selectedNode.description}</p> : null}
                    <ul className={styles.panelList}>
                      {selectedEdges.slice(0, 6).map((e) => (
                        <li key={e.id}>{e.explanation}</li>
                      ))}
                    </ul>
                    <div className={styles.cardMeta}>
                      <Link className="action" href={articlePath(selectedNode.title)}>
                        Read <Icon name="arrow-right" size={11} />
                      </Link>
                      {selectedNode.url ? (
                        <a className="action" href={selectedNode.url} target="_blank" rel="noopener noreferrer">
                          Wikipedia <Icon name="arrow-up-right" size={10} />
                        </a>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="related-heading">
            <div className={styles.sectionHead}>
              <h2 id="related-heading" className={styles.sectionTitle}>
                Related articles
              </h2>
              <span className="label">Up to level {depth}</span>
            </div>
            <ArticleCollection nodes={visible} edges={edges} selected={selected} onSelect={(id) => select(id, true)} />
          </section>
        </div>

        <aside className={styles.side} aria-label="Explore further">
          <section className={styles.panel} aria-labelledby="map-heading">
            <h2 id="map-heading" className="label">
              Rabbit hole map
            </h2>
            <div style={{ marginTop: 12 }}>
              <Outline nodes={nodes} depth={depth} rootTitle="Submission" />
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="further-heading">
            <h2 id="further-heading" className="label">
              Go further
            </h2>
            <ul className={styles.panelList}>
              {beyond.map((n) => (
                <li key={n.id}>
                  <button type="button" className="action" onClick={() => select(n.id, true)}>
                    Level {n.level}
                  </button>{" "}
                  <Link href={articlePath(n.title)}>{n.title}</Link>
                </li>
              ))}
              {primary ? (
                <li>
                  Continue from <Link href={`${articlePath(primary.title)}#rabbit-hole`}>{primary.title}</Link> in the reader&rsquo;s Rabbit
                  Hole.
                </li>
              ) : null}
            </ul>
          </section>

          <section className={styles.panel} aria-labelledby="entities-heading">
            <h2 id="entities-heading" className="label">
              What was extracted
            </h2>
            <ul className={styles.panelList} data-testid="hole-entities">
              {exploration.entities.map((e) => (
                <li key={`${e.entity}-${e.title ?? e.reason}`} className={styles.entity}>
                  <span className={styles.entityLine}>
                    <span className={styles.entityPhrase}>{e.entity}</span>
                    {e.status === "resolved" && e.title ? (
                      <>
                        <span className={styles.muted}>→</span>
                        <Link href={articlePath(e.title)}>{e.title}</Link>
                      </>
                    ) : (
                      <span className={styles.muted}>{REASON_LABELS[e.reason ?? ""] ?? "not matched"}</span>
                    )}
                  </span>
                  <span className={styles.muted}>
                    From the {e.source === "text" ? "post" : e.source === "comments" ? "discussion" : e.source}
                    {e.confidence ? ` · ${Math.round(e.confidence * 100)}% · ${e.method}` : ""}
                    {e.closest ? ` · closest: ${e.closest.title}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.panel} aria-labelledby="quality-heading">
            <h2 id="quality-heading" className="label">
              Rabbit hole quality · {Math.round(quality.score)}
            </h2>
            <div className={styles.bars}>
              {QUALITY_COMPONENTS.map((key) => (
                <div key={key} className={styles.barRow}>
                  <span>{QUALITY_LABELS[key]}</span>
                  <span className={styles.bar} aria-hidden="true">
                    <span style={{ width: `${Math.round(quality.components[key] * 100)}%` }} />
                  </span>
                  <span className={styles.barValue}>{quality.components[key].toFixed(2)}</span>
                </div>
              ))}
            </div>
            <p className={styles.muted} style={{ marginTop: 14 }}>
              Submission from the Hacker News API. Article text from Wikipedia, CC BY-SA 4.0. Every relation names the place in
              Wikipedia it comes from.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
