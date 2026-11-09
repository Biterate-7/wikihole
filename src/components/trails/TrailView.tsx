"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ThumbImage } from "@/components/ui/ThumbImage";
import { trailsFromPath } from "@/lib/trails/paths";
import type { ResolvedTrail, TrailConnection, TrailStop } from "@/lib/trails/types";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./trails.module.css";

const THUMB = 48;

function positionLabel(index: number, total: number): string {
  if (index === 0) return "Start";
  if (index === total - 1) return "Destination";
  return `Step ${index + 1} of ${total}`;
}

function Thumb({ stop, loading }: { stop: TrailStop; loading: boolean }) {
  const [failed, setFailed] = useState(false);
  if (loading) return <span className={`${styles.thumb} skeleton`} aria-hidden="true" />;
  if (stop.thumbnail && !failed) {
    return (
      <span className={styles.thumb}>
        <ThumbImage thumbnail={stop.thumbnail} size={THUMB} onFail={() => setFailed(true)} />
      </span>
    );
  }
  // No image on Wikipedia (or it failed to load): a quiet initial keeps the cards aligned.
  return (
    <span className={`${styles.thumb} ${styles.noThumb}`} aria-hidden="true">
      {stop.title.charAt(0)}
    </span>
  );
}

function Card({
  stop,
  index,
  total,
  payoff,
  loading,
  heading: Heading,
}: {
  heading: "h3" | "h4";
  stop: TrailStop;
  index: number;
  total: number;
  payoff: string;
  loading: boolean;
}) {
  const isDestination = index === total - 1;
  const missing = stop.status === "missing";
  return (
    <div className={styles.card} data-testid="trail-card" data-status={loading ? "loading" : stop.status}>
      <Thumb stop={stop} loading={loading} />
      <div className={styles.cardBody}>
        <p className={styles.position}>{positionLabel(index, total)}</p>
        <Heading className={styles.cardTitle}>
          {missing ? (
            <span>{stop.title}</span>
          ) : (
            <Link href={articlePath(stop.title)} className={styles.cardLink} prefetch={false}>
              {stop.title}
            </Link>
          )}
        </Heading>
        {loading ? (
          <span className={`${styles.descSkeleton} skeleton`} aria-hidden="true" />
        ) : missing ? (
          <p className={styles.desc}>This article is not on Wikipedia at the moment.</p>
        ) : stop.description ? (
          <p className={styles.desc}>{stop.description}</p>
        ) : null}
        {isDestination ? (
          <p className={styles.payoff} data-testid="trail-payoff">
            <b>Why it&rsquo;s unexpected:</b> {payoff}
          </p>
        ) : null}
        {index > 0 && !missing && stop.startable ? (
          <p className={styles.cardActions}>
            <Link href={trailsFromPath(stop.title)} className="action" prefetch={false} aria-label={`Start a trail from ${stop.title}`}>
              Start a trail here
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Connection({
  connection,
  from,
  to,
  open,
  onToggle,
}: {
  connection: TrailConnection;
  from: string;
  to: string;
  open: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  return (
    <div className={styles.connection} data-testid="trail-connection">
      <p className={styles.summary}>{connection.summary}</p>
      <button type="button" className={`action ${styles.toggle}`} aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span className={styles.chevron} aria-hidden="true" />
        {open ? "Hide details" : "How they connect"}
        <span className="visually-hidden">
          : {from} to {to}
        </span>
      </button>
      <div id={id} hidden={!open} className={styles.detail} data-testid="trail-detail">
        <p>{connection.detail}</p>
        {connection.evidence ? (
          <figure className={styles.evidence}>
            <blockquote>{connection.evidence.quote}</blockquote>
            <figcaption>
              From{" "}
              <Link href={articlePath(connection.evidence.source)} prefetch={false}>
                {connection.evidence.source}
              </Link>{" "}
              on Wikipedia, where it links to {to}.
            </figcaption>
          </figure>
        ) : (
          <p className={styles.source}>
            Source:{" "}
            <Link href={articlePath(from)} prefetch={false}>
              {from}
            </Link>{" "}
            links to {to} on Wikipedia.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One trail: article cards joined by a rail, with the reason for each step
 * between them. The reason's summary is always visible; the full explanation
 * and its source expand on request, one at a time or all together.
 */
export function TrailView({
  trail,
  loading = false,
  cardHeading = "h3",
}: {
  trail: ResolvedTrail;
  loading?: boolean;
  /** One level below the heading that names the trail. */
  cardHeading?: "h3" | "h4";
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const total = trail.stops.length;
  const allOpen = open.size === trail.connections.length;
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className={styles.trailWrap} data-testid="trail" data-trail-id={trail.id}>
      <div className={styles.trailTools}>
        <button
          type="button"
          className="action"
          aria-pressed={allOpen}
          onClick={() => setOpen(allOpen ? new Set() : new Set(trail.connections.map((_, i) => i)))}
        >
          {allOpen ? "Collapse all connections" : "Expand all connections"}
        </button>
      </div>
      <ol className={styles.trail} aria-label={`Trail from ${trail.stops[0].title} to ${trail.stops[total - 1].title}`}>
        {trail.stops.map((stop, i) => {
          const connection = trail.connections[i];
          const isDestination = i === total - 1;
          return (
            <li
              key={`${stop.title}-${i}`}
              className={`${styles.stop} ${i === 0 ? styles.start : ""} ${isDestination ? styles.destination : ""}`}
            >
              <span className={styles.marker} aria-hidden="true">
                {i + 1}
              </span>
              <Card stop={stop} index={i} total={total} payoff={trail.payoff} loading={loading} heading={cardHeading} />
              {connection && !isDestination ? (
                <Connection
                  connection={connection}
                  from={stop.title}
                  to={trail.stops[i + 1].title}
                  open={open.has(i)}
                  onToggle={() => toggle(i)}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
