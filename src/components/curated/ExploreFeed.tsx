"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedItemSkeleton } from "@/components/feed/FeedItem";
import styles from "@/components/feed/feed.module.css";
import { Icon } from "@/components/ui/Icon";
import { StateMessage } from "@/components/ui/StateMessage";
import { ApiError, fetchExplore } from "@/lib/api-client";
import type { CuratedItem as Item, CuratedPage, ExploreArea, ExploreSort } from "@/lib/curated/service";
import { historyStore, markSeen, seenStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { CuratedItem } from "./CuratedItem";

const AREAS: Array<{ id: ExploreArea | null; label: string }> = [
  { id: null, label: "All" },
  { id: "Culture", label: "Culture" },
  { id: "Geography", label: "Geography" },
  { id: "History_and_Society", label: "History and society" },
  { id: "STEM", label: "Science and technology" },
];

const SORTS: Array<{ id: ExploreSort; label: string; hint: string }> = [
  { id: "surprise", label: "Surprise me", hint: "A fresh, varied random draw, favouring promising articles" },
  { id: "promising", label: "Most promising", hint: "Best by quality, depth and how articles connect" },
  { id: "quiet", label: "Quietest", hint: "The least visited articles first" },
];

type Status = "ready" | "loading" | "appending" | "error";

interface Query {
  query: string;
  area: ExploreArea | null;
  sort: ExploreSort;
  unrecommended: boolean;
}

function urlFor({ query, area, sort, unrecommended }: Query): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (area) params.set("area", area);
  if (sort !== "surprise") params.set("sort", sort);
  if (unrecommended) params.set("new", "1");
  const qs = params.toString();
  return qs ? `/discover/explore?${qs}` : "/discover/explore";
}

export function ExploreFeed({ initial, query: initialQuery }: { initial: CuratedPage | null; query: Query }) {
  const [filters, setFilters] = useState(initialQuery);
  const [draft, setDraft] = useState(initialQuery.query);
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [nextOffset, setNextOffset] = useState<number | null>(initial?.nextOffset ?? null);
  const [status, setStatus] = useState<Status>(initial ? "ready" : "error");
  const [error, setError] = useState<string | null>(initial ? null : "Could not load the catalogue.");
  const controller = useRef<AbortController | null>(null);
  const history = useStore(historyStore);
  const hydrated = useHydrated();
  const visited = useMemo(() => new Set(history.map((entry) => entry.title)), [history]);
  const isDraw = (q: Query) => q.sort === "surprise" && !q.query;

  useEffect(() => {
    if (initial) markSeen(initial.items.map((item) => item.pageId));
  }, [initial]);
  useEffect(() => () => controller.current?.abort(), []);

  const load = useCallback(async (next: Query, mode: "replace" | "append", offset: number) => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setStatus(mode === "replace" ? "loading" : "appending");
    setError(null);
    try {
      const draw = next.sort === "surprise" && !next.query;
      const page = await fetchExplore(
        { query: next.query || undefined, area: next.area, sort: next.sort, unrecommended: next.unrecommended, offset, limit: 12, ...(draw ? { exclude: seenStore.get().slice(-600) } : {}) },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      markSeen(page.items.map((item) => item.pageId));
      setItems((current) => {
        if (mode === "replace") return page.items;
        const known = new Set(current.map((item) => item.pageId));
        return [...current, ...page.items.filter((item) => !known.has(item.pageId))];
      });
      setTotal(page.total);
      setNextOffset(page.nextOffset);
      setStatus("ready");
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof ApiError ? err.message : "Could not load the catalogue.");
      setStatus("error");
    }
  }, []);

  const apply = (patch: Partial<Query>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    window.history.replaceState(null, "", urlFor(next));
    void load(next, "replace", 0);
  };

  return (
    <section id="feed" className={styles.feed} aria-labelledby="feed-heading">
      <h2 id="feed-heading" className="visually-hidden">
        Wikipedia catalogue
      </h2>
      <div className={styles.controls}>
        <div className={styles.filters}>
        <form
          className={styles.controlRow}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ query: draft.trim() });
          }}
        >
          <label className={styles.controlLabel} htmlFor="explore-query">
            Find:
          </label>
          <input
            id="explore-query"
            className={styles.exploreInput}
            type="search"
            value={draft}
            placeholder="Title, description or category"
            maxLength={120}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="btn">
            Filter
          </button>
        </form>
        <div className={styles.controlRow} role="group" aria-label="Area">
          <span className={styles.controlLabel}>Area:</span>
          <ul className={styles.toggleList}>
            {AREAS.map((area) => (
              <li key={area.label}>
                <button type="button" className={styles.toggle} aria-pressed={filters.area === area.id} onClick={() => apply({ area: area.id })}>
                  {area.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        </div>
        <div className={styles.controlRow}>
          <div className={styles.presets} role="group" aria-label="Order">
            <span className={styles.controlLabel}>Order:</span>
            <ul className={styles.toggleList}>
              {SORTS.map((sort) => (
                <li key={sort.id}>
                  <button type="button" className={styles.toggle} aria-pressed={filters.sort === sort.id} title={sort.hint} onClick={() => apply({ sort: sort.id })}>
                    {sort.label}
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className={styles.toggle}
                  aria-pressed={filters.unrecommended}
                  title="Only articles with no recommendations in the discussions we collected"
                  onClick={() => apply({ unrecommended: !filters.unrecommended })}
                >
                  Not yet recommended
                </button>
              </li>
            </ul>
          </div>
          <button type="button" className="btn" onClick={() => void load(filters, "replace", 0)} disabled={status === "loading"}>
            <Icon name="refresh" size={14} /> New batch
          </button>
        </div>
      </div>

      <div aria-live="polite" aria-busy={status === "loading"} className={styles.list} data-testid="explore-feed">
        {status === "loading" ? (
          Array.from({ length: 6 }, (_, i) => <FeedItemSkeleton key={i} />)
        ) : status === "error" && items.length === 0 ? (
          <StateMessage
            kind="error"
            title="The catalogue could not be loaded."
            action={
              <button type="button" className="btn" onClick={() => void load(filters, "replace", 0)}>
                Try again
              </button>
            }
          >
            {error}
          </StateMessage>
        ) : items.length === 0 ? (
          <StateMessage kind="empty" title="No articles match these filters.">
            The filter searches the published part of the catalogue. Use the search box at the top of the page to search all of Wikipedia.
          </StateMessage>
        ) : (
          items.map((item, i) => <CuratedItem key={item.pageId} item={item} rank={i + 1} visited={hydrated && visited.has(item.title)} />)
        )}
      </div>

      {items.length > 0 && status !== "loading" ? (
        <div className={styles.more}>
          {status === "appending" ? (
            <p className="label">Loading more…</p>
          ) : status === "error" ? (
            <div className={styles.inlineError} role="alert">
              <span>{error}</span>
              <button type="button" className="btn" onClick={() => void load(filters, "append", isDraw(filters) ? 0 : items.length)}>
                Retry
              </button>
            </div>
          ) : nextOffset !== null ? (
            <button type="button" className="btn" onClick={() => void load(filters, "append", isDraw(filters) ? 0 : nextOffset)} data-total={total}>
              Load more
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
