"use client";

import Link from "next/link";
import { useState } from "react";
import { SaveButton } from "@/components/ui/SaveButton";
import { ThumbImage } from "@/components/ui/ThumbImage";
import styles from "@/components/feed/feed.module.css";
import { ApiError, fetchSources, type CuratedSource } from "@/lib/api-client";
import type { CuratedItem as Item } from "@/lib/curated/service";
import type { EvidenceItem, RecommendedArticle } from "@/lib/curated/types";
import { formatCount, formatDate, leadSentences } from "@/lib/format";
import { articlePath } from "@/lib/wikipedia/titles";

const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;
const dateOf = (at: number) => formatDate(new Date(at * 1000).toISOString());

const QUALITY: Record<string, string> = { FA: "Featured article", GA: "Good article", A: "A-class", B: "B-class" };

const AREA_LABEL: Record<string, string> = { Culture: "Culture", Geography: "Geography", History_and_Society: "History and society", STEM: "Science and technology" };

/** "STEM.Physics" → "Physics"; "Culture.Media.Films" → "Films". */
function topicLabel(topic: string): string {
  const parts = topic.split(".");
  return (parts.at(-1) ?? topic).replace(/_/g, " ").replace(/\*$/, "") || (AREA_LABEL[parts[0]] ?? topic);
}

function yearsSpan(article: RecommendedArticle): string {
  const first = new Date(article.firstAt * 1000).getUTCFullYear();
  const last = new Date(article.lastAt * 1000).getUTCFullYear();
  return first === last ? String(first) : `${first}–${last}`;
}

function Quote({ evidence }: { evidence: EvidenceItem }) {
  return (
    <li data-testid="curated-evidence">
      {evidence.kind === "comment" || evidence.kind === "essay" ? <>&ldquo;{evidence.excerpt.replace(/\[\[|\]\]/g, "")}&rdquo; </> : <>Submitted as &ldquo;{evidence.excerpt}&rdquo; </>}
      <a href={evidence.url} target="_blank" rel="noopener noreferrer">
        {evidence.community}, {dateOf(evidence.at)}
      </a>
      {evidence.discussionTitle && evidence.kind === "comment" ? (
        <>
          {" "}
          in{" "}
          <a href={evidence.discussionUrl} target="_blank" rel="noopener noreferrer">
            {evidence.discussionTitle}
          </a>
        </>
      ) : null}
    </li>
  );
}

function RecommendationEvidence({ article }: { article: RecommendedArticle }) {
  const [sources, setSources] = useState<CuratedSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = article.evidence.length;
  const load = () => {
    setError(null);
    fetchSources(article.id)
      .then((result) => setSources(result.sources))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load the sources."));
  };
  return (
    <div className={styles.breakdown}>
      <p>
        {plural(article.qualifying, "recommendation")} from {plural(article.recommenders, "person").replace("persons", "people")} in{" "}
        {plural(article.discussions, "discussion")}, across {plural(article.months, "month")} ({yearsSpan(article)}): {formatCount(article.inWords)} in words,{" "}
        {formatCount(article.qualifying - article.inWords)} shared and upvoted.
        {article.otherMentions > 0 ? ` A further ${plural(article.otherMentions, "mention")} only cited it or passed it by, and do not count.` : ""}
        {article.criticism > 0 ? ` Of those, ${plural(article.criticism, "mention")} criticised it.` : ""}
      </p>
      <ul className={styles.signals}>
        {article.evidence.map((evidence) => (
          <Quote key={evidence.url} evidence={evidence} />
        ))}
      </ul>
      {sources ? (
        <ul className={styles.signals} data-testid="curated-sources">
          {sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.community}, {dateOf(source.at)}
              </a>
            </li>
          ))}
        </ul>
      ) : article.qualifying > shown ? (
        <p>
          <button type="button" className="action" onClick={load}>
            All {article.qualifying} sources
          </button>
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function CatalogueSignals({ item }: { item: Item }) {
  const signals: string[] = [];
  if (item.sources?.includes("featured")) signals.push("Listed by Wikipedia's editors as a featured article");
  else if (item.sources?.includes("good")) signals.push("Listed by Wikipedia's editors as a good article");
  if (item.sources?.includes("unusual")) signals.push("On Wikipedia's own list of unusual articles");
  if (item.incomingLinks !== undefined) signals.push(`${formatCount(item.incomingLinks)} articles link here`);
  if (item.monthlyClicks !== undefined) signals.push(`Readers arrived ${formatCount(item.monthlyClicks)} times last month`);
  if (item.instanceOf?.length) signals.push(`Wikidata: instance of ${item.instanceOf.join(", ")}`);
  if (item.topics?.length) signals.push(`Topics: ${item.topics.map(topicLabel).join(", ")}`);
  return (
    <div className={styles.breakdown}>
      <ul className={styles.signals}>
        {signals.map((signal) => (
          <li key={signal}>{signal}</li>
        ))}
      </ul>
    </div>
  );
}

/** One article, laid out as a Wikipedia search result, like the Discover feed's entries. */
export function CuratedItem({ item, rank, visited }: { item: Item; rank: number; visited?: boolean }) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const href = articlePath(item.title);
  const article = item.recommendation;
  const quality = item.assessment ? QUALITY[item.assessment] : undefined;
  const panelId = `evidence-${item.pageId}`;

  return (
    <article className={styles.item} data-testid="curated-item" data-title={item.title} data-rank={rank}>
      {item.thumbnail && !imageFailed ? (
        <Link href={href} className={styles.thumb} tabIndex={-1} aria-hidden="true">
          <ThumbImage thumbnail={item.thumbnail} size={80} onFail={() => setImageFailed(true)} />
        </Link>
      ) : null}
      <div className={styles.body}>
        <h2 className={styles.title}>
          <Link href={href} className={styles.titleLink}>
            {item.title}
          </Link>
          {visited ? <span className={styles.visited}>(read)</span> : null}
        </h2>
        {item.topics?.length ? <p className={`label ${styles.kicker}`}>{item.topics.slice(0, 2).map(topicLabel).join(" › ")}</p> : null}
        {item.description ? <p className={styles.description}>{item.description}</p> : null}
        {item.extract ? <p className={styles.extract}>{leadSentences(item.extract, 300)}</p> : null}
        <div className={styles.meta}>
          {article ? (
            <>
              <span data-testid="curated-count">{plural(article.qualifying, "recommendation")}</span>
              <span className="dot">{plural(article.discussions, "discussion")}</span>
              <span className="dot">{yearsSpan(article)}</span>
            </>
          ) : null}
          {item.readingMinutes !== undefined ? <span className={article ? "dot" : undefined}>{item.readingMinutes} min read</span> : null}
          {quality ? <span className="dot">{quality}</span> : null}
          {item.monthlyClicks !== undefined ? <span className="dot">{formatCount(item.monthlyClicks)} visits last month</span> : null}
        </div>
        <div className={styles.actions}>
          <SaveButton
            article={{
              title: item.title,
              description: item.description,
              extract: item.extract ? leadSentences(item.extract, 300) : undefined,
              thumbnail: item.thumbnail,
              readingMinutes: item.readingMinutes,
            }}
          />
          <span className="dot" aria-hidden="true" />
          <Link href={`${href}#rabbit-hole`} className="action">
            Rabbit hole
          </Link>
          <span className="dot" aria-hidden="true" />
          <a className="action" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} on Wikipedia (opens in new tab)`}>
            Wikipedia
          </a>
          <span className="dot" aria-hidden="true" />
          <button type="button" className={`action ${styles.scoreToggle}`} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
            {article ? "Why people recommend it" : "Wikipedia signals"}
          </button>
        </div>
        <div id={panelId} hidden={!open}>
          {open ? article ? <RecommendationEvidence article={article} /> : <CatalogueSignals item={item} /> : null}
        </div>
      </div>
    </article>
  );
}
