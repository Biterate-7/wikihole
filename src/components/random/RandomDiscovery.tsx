"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScoreBreakdown } from "@/components/feed/ScoreBreakdown";
import { Icon } from "@/components/ui/Icon";
import { SaveButton } from "@/components/ui/SaveButton";
import { StateMessage } from "@/components/ui/StateMessage";
import { ThumbImage } from "@/components/ui/ThumbImage";
import { ApiError, fetchRandom } from "@/lib/api-client";
import type { RandomResponse } from "@/lib/discovery/engine";
import type { Discovery, RejectReason } from "@/lib/discovery/types";
import { formatCount, leadSentences } from "@/lib/format";
import { markSeen, seenStore } from "@/lib/storage/collections";
import { articlePath } from "@/lib/wikipedia/titles";
import { PAGEVIEW_DAYS } from "@/lib/wikipedia/types";
import styles from "./random.module.css";

const REASON_LABELS: Record<RejectReason, string> = {
  stub: "stubs",
  biography: "biographies",
  "non-technical": "non-technical",
  disambiguation: "disambiguation pages",
  list: "lists",
  entertainment: "entertainment",
  sports: "sports",
  geography: "places",
  organization: "organisations",
  date: "dates and numbers",
  "missing-extract": "no usable intro",
};

type Stats = RandomResponse["stats"];

export function RandomDiscovery() {
  const [current, setCurrent] = useState<Discovery | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const queue = useRef<Discovery[]>([]);
  const inflight = useRef<Promise<RandomResponse> | null>(null);

  const request = useCallback((): Promise<RandomResponse> => {
    if (!inflight.current) {
      const exclude = [...seenStore.get().slice(-600), ...queue.current.map((d) => d.pageId)];
      inflight.current = fetchRandom({ exclude })
        .then((res) => {
          setStats(res.stats);
          return res;
        })
        .finally(() => {
          inflight.current = null;
        });
    }
    return inflight.current;
  }, []);

  const show = useCallback((d: Discovery) => {
    setCurrent(d);
    markSeen([d.pageId]);
    window.scrollTo({ top: 0 });
  }, []);

  const next = useCallback(async () => {
    setError(null);
    const queued = queue.current.shift();
    if (queued) {
      show(queued);
      // Keep a couple of discoveries ready so "another" is instant.
      if (queue.current.length < 2) {
        request()
          .then((res) => queue.current.push(...res.queue, ...(res.discovery ? [res.discovery] : [])))
          .catch(() => {
            // Prefetch failures surface on the next explicit request.
          });
      }
      return;
    }
    setLoading(true);
    try {
      const res = await request();
      queue.current.push(...res.queue);
      if (res.discovery) show(res.discovery);
      else setError("No candidate in this sample passed the quality gate. Try again for a fresh sample.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach Wikipedia.");
    } finally {
      setLoading(false);
    }
  }, [request, show]);

  // First draw on mount (state is only set from promise callbacks).
  useEffect(() => {
    request()
      .then((res) => {
        queue.current.push(...res.queue);
        if (res.discovery) show(res.discovery);
        else setError("No candidate in this sample passed the quality gate. Try again for a fresh sample.");
      })
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not reach Wikipedia."))
      .finally(() => setLoading(false));
  }, [request, show]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "n" || e.key === "N") void next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);

  if (error && !current) {
    return (
      <StateMessage
        kind="error"
        title="Random discovery failed."
        action={
          <button type="button" className="btn" onClick={() => void next()}>
            Try again
          </button>
        }
      >
        {error}
      </StateMessage>
    );
  }

  if (!current) {
    return (
      <div className={styles.card} aria-busy="true">
        <p className="label">Sampling Wikipedia…</p>
        <div className="skeleton" style={{ width: "60%", height: 40, margin: "18px 0 14px" }} />
        <div className="skeleton" style={{ width: "90%", height: 14, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: "80%", height: 14 }} />
      </div>
    );
  }

  const rejected = stats
    ? (Object.entries(stats.rejected) as Array<[RejectReason, number]>).sort((a, b) => b[1] - a[1]).slice(0, 4)
    : [];

  return (
    <div className={styles.wrap}>
      <article className={styles.card} data-testid="random-discovery" aria-live="polite">
        <div className={styles.cardHead}>
          <div className={styles.cardText}>
            <p className="label">{[current.groupLabel, current.subtopicLabel].filter(Boolean).join(" · ") || "Discovery"}</p>
            <h2 className={styles.title}>
              <Link href={articlePath(current.title)}>{current.title}</Link>
            </h2>
            {current.description ? <p className={styles.description}>{current.description}</p> : null}
          </div>
          {current.thumbnail ? <ThumbImage thumbnail={current.thumbnail} size={120} /> : null}
        </div>
        <p className={styles.extract}>{leadSentences(current.extract, 520)}</p>
        <p className={`label ${styles.meta}`}>
          {current.readingMinutes} min read
          {current.date ? <span className="dot">{`${current.date.label} ${current.date.year}`}</span> : null}
          {current.recentViews !== null ? (
            <span className="dot">
              {formatCount(current.recentViews)} views/{PAGEVIEW_DAYS}d
            </span>
          ) : null}
          <span className="dot">Score {Math.round(current.score.total)}</span>
        </p>
        <div className={styles.actions}>
          <Link href={articlePath(current.title)} className="btn btn-primary">
            Read article <Icon name="arrow-right" size={14} />
          </Link>
          <button type="button" className="btn" onClick={() => void next()} disabled={loading} aria-keyshortcuts="n">
            <Icon name="shuffle" size={14} /> Another discovery
          </button>
          <Link href={`${articlePath(current.title)}#rabbit-hole`} className="btn">
            Explore deeper <Icon name="corner-down-right" size={14} />
          </Link>
          <SaveButton
            variant="button"
            article={{
              title: current.title,
              description: current.description,
              extract: leadSentences(current.extract, 300),
              thumbnail: current.thumbnail,
              readingMinutes: current.readingMinutes,
              groupLabel: current.groupLabel,
            }}
          />
        </div>
        {error ? (
          <p className={styles.inlineError} role="alert">
            {error}
          </p>
        ) : null}
      </article>

      <aside className={styles.why} aria-label="Why this article">
        <h2>Why this one</h2>
        <ScoreBreakdown score={current.score} />
        {stats ? (
          <p className={styles.stats} data-testid="random-stats">
            Chosen from {stats.sampled} sampled articles, including {stats.uniformSample} uniformly random pages (
            {stats.uniformAccepted} passed). {stats.accepted} passed the quality gate
            {rejected.length ? `; rejected: ${rejected.map(([r, n]) => `${n} ${REASON_LABELS[r]}`).join(", ")}` : ""}.
          </p>
        ) : null}
        <p className="label">Press N for another discovery.</p>
      </aside>
    </div>
  );
}
