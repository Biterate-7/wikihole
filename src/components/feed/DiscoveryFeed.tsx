"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { StateMessage } from "@/components/ui/StateMessage";
import { ApiError, fetchFeed } from "@/lib/api-client";
import type { FeedResponse } from "@/lib/discovery/engine";
import type { Discovery, FeedPreset } from "@/lib/discovery/types";
import { historyStore, markSeen, seenStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { FeedItem, FeedItemSkeleton } from "./FeedItem";
import { TopicFilter } from "./TopicFilter";
import styles from "./feed.module.css";

const PAGE_SIZE = 12;
const MAX_ITEMS = 144;

const PRESETS: Array<{ id: FeedPreset; label: string; hint: string }> = [
  { id: "balanced", label: "Balanced", hint: "Default weights of the discovery model" },
  { id: "deep", label: "Deep", hint: "Favour substantial, conceptually dense articles" },
  { id: "obscure", label: "Obscure", hint: "Favour rarely read articles (still quality-gated)" },
];

type Status = "ready" | "loading" | "appending" | "error";

interface Props {
  initial: FeedResponse | null;
  initialError?: string | null;
  topic: string | null;
  preset: FeedPreset;
  /** On topic pages the topic is fixed by the route. */
  fixedTopic?: boolean;
  /** Render as a loading placeholder (Suspense fallback) without fetching. */
  pending?: boolean;
}

export function DiscoveryFeed({
  initial,
  initialError = null,
  topic: initialTopic,
  preset: initialPreset,
  fixedTopic,
  pending,
}: Props) {
  const [items, setItems] = useState<Discovery[]>(initial?.items ?? []);
  const [status, setStatus] = useState<Status>(initial ? "ready" : pending ? "loading" : "error");
  const [error, setError] = useState<string | null>(initial || pending ? null : (initialError ?? "Could not load discoveries."));
  const [exhausted, setExhausted] = useState(false);
  // Which kind of load failed: a refresh keeps the old batch visible under a banner.
  const [failedMode, setFailedMode] = useState<"replace" | "append">("replace");
  const [topic, setTopic] = useState(initialTopic);
  const [preset, setPreset] = useState(initialPreset);
  const controller = useRef<AbortController | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const history = useStore(historyStore);
  const hydrated = useHydrated();
  const visited = useMemo(() => new Set(history.map((h) => h.title)), [history]);

  const load = useCallback(
    async (mode: "replace" | "append", nextTopic: string | null, nextPreset: FeedPreset) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      setStatus(mode === "replace" ? "loading" : "appending");
      setError(null);
      try {
        const feed = await fetchFeed(
          { topic: nextTopic, preset: nextPreset, exclude: seenStore.get().slice(-600), limit: PAGE_SIZE },
          ac.signal,
        );
        if (ac.signal.aborted) return;
        markSeen(feed.items.map((i) => i.pageId));
        setItems((current) => {
          if (mode === "replace") return feed.items;
          const known = new Set(current.map((i) => i.pageId));
          return [...current, ...feed.items.filter((i) => !known.has(i.pageId))].slice(0, MAX_ITEMS);
        });
        setExhausted(feed.items.length === 0);
        setStatus("ready");
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Could not load discoveries.");
        setFailedMode(mode);
        setStatus("error");
      }
    },
    [],
  );

  // Initial articles count as seen so refreshes and later pages never repeat them.
  useEffect(() => {
    if (!pending && initial) markSeen(initial.items.map((i) => i.pageId));
  }, [initial, pending]);

  useEffect(() => () => controller.current?.abort(), []);

  // Infinite scroll.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || status !== "ready" || exhausted || items.length >= MAX_ITEMS || items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void load("append", topic, preset);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [status, exhausted, items.length, load, topic, preset]);

  const syncUrl = (nextTopic: string | null, nextPreset: FeedPreset) => {
    if (fixedTopic) return;
    const params = new URLSearchParams();
    if (nextTopic) params.set("topic", nextTopic);
    if (nextPreset !== "balanced") params.set("mode", nextPreset);
    const qs = params.toString();
    // Native history update: Next keeps it in sync without re-rendering the server feed.
    window.history.replaceState(null, "", qs ? `/discover?${qs}` : "/discover");
  };

  const changeTopic = (next: string | null) => {
    setTopic(next);
    setExhausted(false);
    syncUrl(next, preset);
    void load("replace", next, preset);
  };

  const changePreset = (next: FeedPreset) => {
    setPreset(next);
    setExhausted(false);
    syncUrl(topic, next);
    void load("replace", topic, next);
  };

  const refresh = () => {
    setExhausted(false);
    void load("replace", topic, preset);
    document.getElementById("feed")?.scrollIntoView({ block: "start" });
  };

  return (
    <section id="feed" className={styles.feed} aria-labelledby="feed-heading">
      <h2 id="feed-heading" className="visually-hidden">
        Discoveries
      </h2>
      {fixedTopic ? null : <TopicFilter value={topic} onChange={changeTopic} />}

      <div className={styles.controls}>
        <div className={styles.presets} role="group" aria-label="Ranking mode">
          <span className="label">Rank</span>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn"
              aria-pressed={preset === p.id}
              title={p.hint}
              onClick={() => preset !== p.id && changePreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="action" onClick={refresh} disabled={status === "loading"}>
          <Icon name="refresh" size={12} /> New batch
        </button>
      </div>

      {status === "error" && failedMode === "replace" && items.length > 0 ? (
        <div className={styles.banner} role="alert">
          <span>{error} Showing the previous batch.</span>
          <button type="button" className="btn" onClick={() => void load("replace", topic, preset)}>
            Try again
          </button>
        </div>
      ) : null}

      <div aria-live="polite" aria-busy={status === "loading"} className={styles.list} data-testid="feed">
        {status === "loading" ? (
          Array.from({ length: 6 }, (_, i) => <FeedItemSkeleton key={i} />)
        ) : status === "error" && items.length === 0 ? (
          <StateMessage
            kind="error"
            title="The rabbit hole is temporarily blocked."
            action={
              <button type="button" className="btn" onClick={() => void load("replace", topic, preset)}>
                Try again
              </button>
            }
          >
            {error}
          </StateMessage>
        ) : items.length === 0 ? (
          <StateMessage
            kind="empty"
            title="No new discoveries match right now."
            action={
              <button type="button" className="btn" onClick={refresh}>
                Draw a new sample
              </button>
            }
          >
            Every candidate in this topic has either been shown this session or failed the quality gate.
          </StateMessage>
        ) : (
          items.map((item, i) => (
            <FeedItem key={item.pageId} item={item} rank={i + 1} visited={hydrated && visited.has(item.title)} />
          ))
        )}
      </div>

      {items.length > 0 && status !== "loading" ? (
        <div className={styles.more}>
          <div ref={sentinel} aria-hidden="true" />
          {status === "appending" ? (
            <p className="label">Digging deeper…</p>
          ) : status === "error" && failedMode === "append" ? (
            <div className={styles.inlineError} role="alert">
              <span>{error}</span>
              <button type="button" className="btn" onClick={() => void load("append", topic, preset)}>
                Retry
              </button>
            </div>
          ) : items.length >= MAX_ITEMS || exhausted ? (
            <div className={styles.inlineError}>
              <span className="label">{exhausted ? "This topic is exhausted for now" : "You have gone a long way down"}</span>
              <button type="button" className="btn" onClick={refresh}>
                Start a fresh batch
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => void load("append", topic, preset)}>
              Load more
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
