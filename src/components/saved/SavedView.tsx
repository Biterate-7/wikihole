"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { StateMessage } from "@/components/ui/StateMessage";
import { ThumbImage } from "@/components/ui/ThumbImage";
import { formatRelative } from "@/lib/format";
import { clearHistory, historyStore, removeSaved, savedStore, trailsStore } from "@/lib/storage/collections";
import { useHydrated, useStore } from "@/lib/storage/hooks";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./saved.module.css";

type Tab = "saved" | "history" | "trails";

export function SavedView() {
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<Tab>(initial === "history" || initial === "trails" ? initial : "saved");
  const hydrated = useHydrated();
  const saved = useStore(savedStore);
  const history = useStore(historyStore);
  const trails = useStore(trailsStore);
  const [confirming, setConfirming] = useState(false);

  const select = (next: Tab) => {
    setTab(next);
    setConfirming(false);
    window.history.replaceState(null, "", next === "saved" ? "/saved" : `/saved?tab=${next}`);
  };

  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "saved", label: "Saved", count: saved.length },
    { id: "history", label: "History", count: history.length },
    { id: "trails", label: "Trails", count: trails.filter((t) => t.steps.length > 1).length },
  ];

  if (!hydrated) {
    return <p className="label">Loading your library…</p>;
  }

  return (
    <div>
      <div className={styles.tabs} role="tablist" aria-label="Library">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={styles.tab}
            onClick={() => select(t.id)}
          >
            {t.label} <span className={styles.tabCount}>{t.count}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={styles.panel}>
        {tab === "saved" ? (
          saved.length === 0 ? (
            <StateMessage
              kind="empty"
              title="You haven't saved anything yet."
              action={
                <Link className="btn" href="/">
                  Browse discoveries
                </Link>
              }
            >
              Use Save on any article to keep it here. Saved articles are stored in this browser only.
            </StateMessage>
          ) : (
            <ul className={styles.list} data-testid="saved-list">
              {saved.map((item) => (
                <li key={item.title} className={styles.item} data-testid="saved-item">
                  <div className={styles.itemBody}>
                    <p className="label">
                      {item.groupLabel ?? "Saved"}
                      <span className="dot">{formatRelative(item.savedAt)}</span>
                    </p>
                    <h2 className={styles.itemTitle}>
                      <Link href={articlePath(item.title)}>{item.title}</Link>
                    </h2>
                    {item.description ? <p className={styles.itemDesc}>{item.description}</p> : null}
                    {item.extract ? <p className={styles.itemExtract}>{item.extract}</p> : null}
                    <div className={styles.itemActions}>
                      {item.readingMinutes ? <span className="label">{item.readingMinutes} min read</span> : null}
                      <button
                        type="button"
                        className="action"
                        onClick={() => removeSaved(item.title)}
                        aria-label={`Remove ${item.title} from saved`}
                      >
                        <Icon name="close" size={11} /> Remove
                      </button>
                    </div>
                  </div>
                  {item.thumbnail ? <ThumbImage thumbnail={item.thumbnail} size={72} /> : null}
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "history" ? (
          history.length === 0 ? (
            <StateMessage kind="empty" title="No reading history yet.">
              Articles you open appear here, most recent first. History stays in this browser.
            </StateMessage>
          ) : (
            <>
              <div className={styles.toolbar}>
                <span className="label">{history.length} articles read</span>
                {confirming ? (
                  <span className={styles.confirm}>
                    <span>Clear all history and trails?</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        clearHistory();
                        setConfirming(false);
                      }}
                    >
                      Clear
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button type="button" className="action" onClick={() => setConfirming(true)}>
                    Clear history
                  </button>
                )}
              </div>
              <ol className={styles.history} data-testid="history-list">
                {history.map((h) => (
                  <li key={h.title}>
                    <Link href={articlePath(h.title)}>{h.title}</Link>
                    {h.description ? <span className={styles.historyDesc}>{h.description}</span> : null}
                    <span className="label">
                      {h.depth && h.depth > 1 ? `depth ${h.depth} · ` : ""}
                      {formatRelative(h.visitedAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )
        ) : null}

        {tab === "trails" ? (
          trails.filter((t) => t.steps.length > 1).length === 0 ? (
            <StateMessage kind="empty" title="No rabbit holes yet.">
              Follow a link or a related article from any article and your path is recorded as a trail.
            </StateMessage>
          ) : (
            <ul className={styles.trails}>
              {trails
                .filter((t) => t.steps.length > 1)
                .map((t) => (
                  <li key={t.id} className={styles.trail}>
                    <p className="label">
                      Depth {t.steps.length}
                      <span className="dot">{formatRelative(t.updatedAt)}</span>
                    </p>
                    <ol className={styles.trailSteps}>
                      {t.steps.map((step, i) => (
                        <li key={`${step}-${i}`}>
                          <Link href={articlePath(step)}>{step}</Link>
                        </li>
                      ))}
                    </ol>
                    <Link className="btn" href={articlePath(t.steps[t.steps.length - 1])}>
                      Resume exploration
                    </Link>
                  </li>
                ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
