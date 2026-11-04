"use client";

import { useState } from "react";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { AiTag, ExplainFailure, ExplainLoading, ExplanationText, useExplanation } from "./Explanation";
import styles from "./reading.module.css";

/**
 * A quiet "summarise" beside a section's heading, in the place Wikipedia puts
 * [edit]. The summary opens under the heading, marked as generated, and the
 * section's own text stays exactly where it was.
 */
export function SectionSummary({ title, lang, sectionId, sectionTitle }: { title: string; lang: string; sectionId: string; sectionTitle: string }) {
  const [open, setOpen] = useState(false);
  const article = { title, ...(lang === DEFAULT_LANGUAGE ? {} : { lang }) };
  const state = useExplanation(open ? { ...article, kind: "section", sectionId } : null);

  return (
    <>
      <button type="button" className={styles.sectionTool} aria-expanded={open} aria-label={`${open ? "Hide the summary of" : "Summarise"} ${sectionTitle}`} onClick={() => setOpen((v) => !v)} data-testid="section-summarise">
        {open ? "hide summary" : "summarise"}
      </button>
      {open && state.status !== "disabled" ? (
        <div className={styles.aiBox} aria-live="polite" data-testid="section-summary">
          <p className={styles.aiBoxHead}>
            <AiTag /> Summary of this section. Not part of the Wikipedia article.
          </p>
          <div lang={lang} dir="auto">
            {state.status === "loading" ? <ExplainLoading label="Summarising this section…" /> : null}
            {state.status === "error" ? <ExplainFailure message={state.message} onRetry={state.retry} /> : null}
            {state.status === "done" ? <ExplanationText explanation={state.explanation} list lang={lang} /> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
