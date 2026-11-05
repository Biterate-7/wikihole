"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedItem, FeedItemSkeleton } from "@/components/feed/FeedItem";
import styles from "@/components/feed/feed.module.css";
import { StateMessage } from "@/components/ui/StateMessage";
import { ApiError, fetchCollection, fetchContextual } from "@/lib/api-client";
import type { CollectionId } from "@/lib/curated/rank";
import type { CuratedItem as Item, CuratedPage } from "@/lib/curated/service";
import type { Discovery } from "@/lib/discovery/types";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { historyStore, seenStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { CuratedItem } from "./CuratedItem";

export type RecommendedView = CollectionId | "for-you";

const VIEWS: Array<{ id: RecommendedView; label: string; hint: string }> = [
  { id: "most", label: "Most recommended", hint: "Sustained recommendations from many independent people" },
  { id: "hidden", label: "Hidden gems", hint: "Recommended by several people, yet read by few" },
  { id: "recent", label: "Recently recommended", hint: "Recommended in the last six months, newest first" },
  { id: "evergreen", label: "Evergreen", hint: "Still being recommended after five years or more" },
  { id: "rising", label: "Rising", hint: "Recommended more in the last year than ever before" },
  { id: "for-you", label: "From your reading", hint: "Built in this browser from your own reading history" },
];

const HISTORY_SEEDS = 8;

type Status = "ready" | "loading" | "appending" | "error";

export function RecommendedFeed({ initial, view: initialView }: { initial: CuratedPage | null; view: RecommendedView }) {
  const [view, setView] = useState(initialView);
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  const [contextual, setContextual] = useState<Discovery[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(initial?.nextOffset ?? null);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [status, setStatus] = useState<Status>(initial || initialView === "for-you" ? "ready" : "error");
  const [error, setError] = useState<string | null>(initial || initialView === "for-you" ? null : "Could not load this collection.");
  const controller = useRef<AbortController | null>(null);
  const started = useRef(false);
  const history = useStore(historyStore);
  const hydrated = useHydrated();
  const visited = useMemo(() => new Set(history.map((entry) => entry.title)), [history]);

  const loadContextual = useCallback(async () => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    const titles = historyStore
      .get()
      .filter((entry) => (entry.lang ?? DEFAULT_LANGUAGE) === DEFAULT_LANGUAGE)
      .slice(0, HISTORY_SEEDS)
      .map((entry) => entry.title);
    if (titles.length === 0) {
      setContextual([]);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const result = await fetchContextual({ titles, exclude: seenStore.get().slice(-600), limit: 12 }, ac.signal);
      if (ac.signal.aborted) return;
      setContextual(result.items);
      setStatus("ready");
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof ApiError ? err.message : "Could not build suggestions from your reading.");
      setStatus("error");
    }
  }, []);

  const load = useCallback(async (next: CollectionId, offset: number) => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setStatus(offset === 0 ? "loading" : "appending");
    setError(null);
    try {
      const page = await fetchCollection(next, offset, ac.signal);
      if (ac.signal.aborted) return;
      setItems((current) => {
        if (offset === 0) return page.items;
        const known = new Set(current.map((item) => item.pageId));
        return [...current, ...page.items.filter((item) => !known.has(item.pageId))];
      });
      setNextOffset(page.nextOffset);
      setTotal(page.total);
      setStatus("ready");
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof ApiError ? err.message : "Could not load this collection.");
      setStatus("error");
    }
  }, []);

  // A link straight to "From your reading" has nothing server-rendered: the history lives here.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialView === "for-you") void Promise.resolve().then(loadContextual);
  }, [initialView, loadContextual]);

  useEffect(() => () => controller.current?.abort(), []);

  const change = (next: RecommendedView) => {
    if (next === view) return;
    setView(next);
    window.history.replaceState(null, "", next === "most" ? "/discover/recommended" : `/discover/recommended?c=${next}`);
    if (next === "for-you") void loadContextual();
    else void load(next, 0);
  };

  const description = VIEWS.find((v) => v.id === view)?.hint;
  const retry = () => (view === "for-you" ? void loadContextual() : void load(view, 0));

  return (
    <section id="feed" className={styles.feed} aria-labelledby="feed-heading">
      <h2 id="feed-heading" className="visually-hidden">
        Recommended articles
      </h2>
      <div className={styles.controls}>
        <div className={styles.filters}>
        <div className={styles.controlRow} role="group" aria-label="Collection">
          <span className={styles.controlLabel}>Show:</span>
          <ul className={styles.toggleList}>
            {VIEWS.map((v) => (
              <li key={v.id}>
                <button type="button" className={styles.toggle} aria-pressed={view === v.id} title={v.hint} onClick={() => change(v.id)}>
                  {v.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        </div>
        <p className={styles.description} data-testid="collection-description">
          {description}
          {view !== "for-you" && total > 0 ? `. ${total} articles, ranked by the evidence.` : "."}
        </p>
      </div>

      <div aria-live="polite" aria-busy={status === "loading"} className={styles.list} data-testid="curated-feed">
        {status === "loading" ? (
          Array.from({ length: 6 }, (_, i) => <FeedItemSkeleton key={i} />)
        ) : status === "error" && (view === "for-you" ? contextual.length === 0 : items.length === 0) ? (
          <StateMessage
            kind="error"
            title="This list could not be loaded."
            action={
              <button type="button" className="btn" onClick={retry}>
                Try again
              </button>
            }
          >
            {error}
          </StateMessage>
        ) : view === "for-you" ? (
          contextual.length ? (
            contextual.map((item, i) => <FeedItem key={item.pageId} item={item} rank={i + 1} visited={hydrated && visited.has(item.title)} showRelation />)
          ) : (
            <StateMessage kind="empty" title="Nothing to go on yet.">
              Suggestions here come from articles you have read in this browser, which stay on this device. Read an article or two, then come back.
            </StateMessage>
          )
        ) : items.length ? (
          items.map((item, i) => <CuratedItem key={item.pageId} item={item} rank={i + 1} visited={hydrated && visited.has(item.title)} />)
        ) : (
          <StateMessage kind="empty" title="Nothing qualifies for this collection yet.">
            Articles only appear here when the collected evidence supports it.
          </StateMessage>
        )}
      </div>

      {view !== "for-you" && items.length > 0 && status !== "loading" ? (
        <div className={styles.more}>
          {status === "appending" ? (
            <p className="label">Loading more…</p>
          ) : status === "error" ? (
            <div className={styles.inlineError} role="alert">
              <span>{error}</span>
              <button type="button" className="btn" onClick={() => void load(view, items.length)}>
                Retry
              </button>
            </div>
          ) : nextOffset !== null ? (
            <button type="button" className="btn" onClick={() => void load(view, nextOffset)}>
              Load more
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
