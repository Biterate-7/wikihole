"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Explanation, ExplainRequest } from "@/lib/ai/explain-types";
import { ApiError, fetchExplanation } from "@/lib/api-client";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./reading.module.css";

type Outcome = { status: "done"; explanation: Explanation } | { status: "disabled" } | { status: "error"; message: string };
export type ExplainState = { status: "idle" } | { status: "loading" } | Outcome;

/**
 * Loads an explanation for a request (or nothing for null). Results come from
 * the shared cache when they can, and a change of request drops the old result.
 */
export function useExplanation(request: ExplainRequest | null): ExplainState & { retry: () => void } {
  const key = request ? JSON.stringify(request) : null;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ id: string; outcome: Outcome } | null>(null);
  const id = key === null ? null : `${attempt}|${key}`;

  useEffect(() => {
    if (id === null || key === null) return;
    let live = true;
    fetchExplanation(JSON.parse(key) as ExplainRequest)
      .then((response): Outcome => (response.enabled ? { status: "done", explanation: response.explanation } : { status: "disabled" }))
      .catch((error: unknown): Outcome => ({ status: "error", message: error instanceof ApiError ? error.message : "The explanation could not be loaded." }))
      .then((outcome) => {
        if (live) setSettled({ id, outcome });
      });
    return () => {
      live = false;
    };
  }, [id, key]);

  const retry = () => setAttempt((n) => n + 1);
  if (id === null) return { status: "idle", retry };
  return settled?.id === id ? { ...settled.outcome, retry } : { status: "loading", retry };
}

/** The label on everything a language model wrote, so it is never mistaken for Wikipedia's text. */
export function AiTag() {
  return <span className={styles.aiTag}>AI-generated</span>;
}

export function ExplainLoading({ label = "Writing an explanation…" }: { label?: string }) {
  return (
    <div className={styles.loading} role="status">
      <span className="visually-hidden">{label}</span>
      <div className="skeleton" style={{ width: "96%", height: 11, marginBottom: 7 }} />
      <div className="skeleton" style={{ width: "88%", height: 11, marginBottom: 7 }} />
      <div className="skeleton" style={{ width: "62%", height: 11 }} />
    </div>
  );
}

export function ExplainFailure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className={styles.failure} role="alert">
      {message}{" "}
      <button type="button" className={styles.linkButton} onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}

export function ExplanationText({ explanation, list, lang }: { explanation: Explanation; list?: boolean; lang: string }) {
  return (
    <>
      {list && explanation.text.length > 1 ? (
        <ul className={styles.points}>
          {explanation.text.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      ) : (
        explanation.text.map((paragraph, i) => (
          <p key={i} className={styles.aiText}>
            {paragraph}
          </p>
        ))
      )}
      {explanation.connections?.length ? (
        <ul className={styles.connections}>
          {explanation.connections.map((connection) => (
            <li key={connection.title}>
              <Link href={articlePath(connection.title, undefined, lang)} prefetch={false}>
                {connection.title}
              </Link>
              <span className={styles.reason}> {connection.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
