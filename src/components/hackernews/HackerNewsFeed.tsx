"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { StateMessage } from "@/components/ui/StateMessage";
import { ApiError, fetchHackerNews } from "@/lib/api-client";
import type { ExplorationPreview } from "@/lib/discovery/hole-types";
import type { FeedCategory, HackerNewsFeed as Feed } from "@/lib/hackernews/service";
import { SubmissionCard, SubmissionCardSkeleton } from "./SubmissionCard";
import styles from "./hackernews.module.css";

const CATEGORIES: Array<{ id: FeedCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "top", label: "Top" },
  { id: "best", label: "Best" },
  { id: "show", label: "Show HN" },
  { id: "ask", label: "Ask HN" },
  { id: "new", label: "New" },
];

const PAGE_SIZE = 15;
/** While submissions are still being analysed, check for new rabbit holes this often. */
const POLL_MS = 9000;
const MAX_POLLS = 20;

type Status = "ready" | "loading" | "appending" | "error";

interface Props {
  initial: Feed | null;
  initialError?: string | null;
  category: FeedCategory;
  /** Render as a loading placeholder (Suspense fallback) without fetching. */
  pending?: boolean;
}

export function HackerNewsFeed({ initial, initialError = null, category: initialCategory, pending }: Props) {
  const [feed, setFeed] = useState<Feed | null>(initial);
  const [items, setItems] = useState<ExplorationPreview[]>(initial?.items ?? []);
  const [status, setStatus] = useState<Status>(initial ? "ready" : pending ? "loading" : "error");
  const [error, setError] = useState<string | null>(initial || pending ? null : (initialError ?? "Could not load Hacker News."));
  const [category, setCategory] = useState(initialCategory);
  const controller = useRef<AbortController | null>(null);
  const polls = useRef(0);

  const load = useCallback(async (mode: "replace" | "append" | "refresh", nextCategory: FeedCategory, offset: number, limit = PAGE_SIZE) => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    if (mode === "replace") setStatus("loading");
    if (mode === "append") setStatus("appending");
    setError(null);
    try {
      const next = await fetchHackerNews({ category: nextCategory, offset, limit }, ac.signal);
      if (ac.signal.aborted) return;
      setFeed(next);
      setItems((current) => {
        if (mode !== "append") return next.items;
        const known = new Set(current.map((i) => i.submission.id));
        return [...current, ...next.items.filter((i) => !known.has(i.submission.id))];
      });
      setStatus("ready");
    } catch (err) {
      if (ac.signal.aborted) return;
      // A failed background refresh keeps what is on screen.
      if (mode === "refresh") return setStatus("ready");
      setError(err instanceof ApiError ? err.message : "Could not load Hacker News.");
      setStatus("error");
    }
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  // New rabbit holes are built in the background: refresh while some are pending.
  const waiting = (feed?.pending ?? 0) > 0 && status === "ready";
  useEffect(() => {
    if (!waiting || polls.current >= MAX_POLLS) return;
    const timer = setTimeout(() => {
      polls.current++;
      void load("refresh", category, 0, Math.min(30, Math.max(items.length, PAGE_SIZE)));
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, load, category, items.length, feed]);

  const changeCategory = (next: FeedCategory) => {
    if (next === category) return;
    setCategory(next);
    polls.current = 0;
    window.history.replaceState(null, "", next === "all" ? "/hackernews" : `/hackernews?category=${next}`);
    void load("replace", next, 0);
  };

  const processing = feed?.processing ?? [];

  return (
    <section className={styles.feed} aria-labelledby="hn-feed-heading">
      <h2 id="hn-feed-heading" className="visually-hidden">
        Rabbit holes from Hacker News
      </h2>
      <div className={styles.controls}>
        <div className={styles.controlRow} role="group" aria-label="Hacker News list">
          <span className={styles.controlLabel}>List:</span>
          <ul className={styles.toggleList}>
            {CATEGORIES.map((c) => (
              <li key={c.id}>
                <button type="button" className={styles.toggle} aria-pressed={category === c.id} onClick={() => changeCategory(c.id)}>
                  {c.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.status} aria-live="polite">
          {status === "loading" ? (
            <span className={styles.statusLive}>
              <span className={styles.pulse} aria-hidden="true" /> Reading Hacker News and resolving Wikipedia articles…
            </span>
          ) : feed ? (
            <>
              <span>
                {feed.total} rabbit hole{feed.total === 1 ? "" : "s"}
                {feed.insufficient ? ` · ${feed.insufficient} too thin to show` : ""}
                {feed.rejected ? ` · ${feed.rejected} filtered out` : ""}
              </span>
              {feed.pending > 0 ? (
                <span className={styles.statusLive}>
                  <span className={styles.pulse} aria-hidden="true" /> {feed.pending} waiting for analysis
                </span>
              ) : null}
            </>
          ) : (
            <span>Hacker News</span>
          )}
        </div>
      </div>
      {processing.length && status !== "loading" ? (
        <ul className={styles.processing} aria-label="Being analysed now">
          {processing.map((p) => (
            <li key={p.id}>{p.title}</li>
          ))}
        </ul>
      ) : null}
      {feed?.warning && status === "ready" ? (
        <p className={styles.processing} role="status">
          Hacker News could not be refreshed just now; showing stored results.
        </p>
      ) : null}

      <div className={styles.list} aria-busy={status === "loading"} data-testid="hn-feed">
        {status === "loading" ? (
          Array.from({ length: 5 }, (_, i) => <SubmissionCardSkeleton key={i} />)
        ) : status === "error" && items.length === 0 ? (
          <StateMessage
            kind="error"
            title="Could not reach the rabbit holes."
            action={
              <button type="button" className="btn" onClick={() => void load("replace", category, 0)}>
                Try again
              </button>
            }
          >
            {error}
          </StateMessage>
        ) : items.length === 0 ? (
          (feed?.pending ?? 0) > 0 ? (
            <>
              <StateMessage kind="empty" title="The first rabbit holes are still being dug.">
                Submissions are being matched to Wikipedia articles in the background. This list refreshes on its own.
              </StateMessage>
              <SubmissionCardSkeleton />
            </>
          ) : (
            <StateMessage
              kind="empty"
              title="No submissions in this list produced a rabbit hole."
              action={
                <button type="button" className="btn" onClick={() => changeCategory("all")}>
                  Show all lists
                </button>
              }
            >
              Every submission here was either filtered out (jobs, career advice, promotion, general news) or did not lead to enough
              well-matched Wikipedia articles.
            </StateMessage>
          )
        ) : (
          items.map((item, i) => <SubmissionCard key={item.submission.id} item={item} rank={i + 1} />)
        )}
      </div>

      {items.length > 0 && status !== "loading" ? (
        <div className={styles.more}>
          {status === "appending" ? (
            <p className="label">Digging deeper…</p>
          ) : status === "error" ? (
            <div className={styles.statusLive} role="alert">
              <span>{error}</span>
              <button type="button" className="btn" onClick={() => void load("append", category, items.length)}>
                Retry
              </button>
            </div>
          ) : feed?.nextOffset !== null && feed?.nextOffset !== undefined ? (
            <button type="button" className="btn" onClick={() => void load("append", category, items.length)}>
              Load more
            </button>
          ) : (
            <button type="button" className="action" onClick={() => void load("refresh", category, 0, Math.min(30, Math.max(items.length, PAGE_SIZE)))}>
              <Icon name="refresh" size={12} /> Check for new rabbit holes
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
