"use client";

import { useState } from "react";
import { AiTag, ExplainFailure, ExplainLoading, ExplanationText, useExplanation } from "@/components/article/Explanation";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import styles from "./history.module.css";

/**
 * A plain-language description of a real diff, generated only on request and
 * kept visibly apart from the diff itself. The server fetches the diff from
 * Wikimedia, so the model describes the record rather than anything the page sends.
 */
export function DiffExplain({ title, lang, from, to }: { title: string; lang: string; from: number; to: number }) {
  const [asked, setAsked] = useState(false);
  const article = { title, ...(lang === DEFAULT_LANGUAGE ? {} : { lang }) };
  const state = useExplanation(asked ? { ...article, kind: "diff", from, to } : null);

  if (!asked) {
    return (
      <p className={styles.explainAsk}>
        <button type="button" className="action" onClick={() => setAsked(true)} data-testid="diff-explain">
          Describe this change in words
        </button>{" "}
        <span className={styles.muted}>(AI-generated)</span>
      </p>
    );
  }
  if (state.status === "disabled") return null;
  return (
    <div className={styles.aiExplain} aria-live="polite" data-testid="diff-explanation">
      <p className={styles.aiExplainHead}>
        <AiTag /> An interpretation, not part of the revision record. The diff below is the record.
      </p>
      <div lang={lang} dir="auto">
        {state.status === "loading" ? <ExplainLoading label="Describing this change…" /> : null}
        {state.status === "error" ? <ExplainFailure message={state.message} onRetry={state.retry} /> : null}
        {state.status === "done" ? <ExplanationText explanation={state.explanation} lang={lang} /> : null}
      </div>
    </div>
  );
}
