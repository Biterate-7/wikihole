"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError, fetchInsights } from "@/lib/api-client";
import type { Insights } from "@/lib/ai/insights";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";
import { articlePath } from "@/lib/wikipedia/titles";
import styles from "./article.module.css";

type State = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "done"; insights: Insights };

function Evidence({ quote }: { quote: string }) {
  return <q className={styles.evidence}>{quote}</q>;
}

/**
 * On-demand AI analysis. Generated only when asked (it costs money), clearly
 * labelled, and every item carries the article quote that grounds it.
 */
export function InsightsPanel({ title, lang = DEFAULT_LANGUAGE }: { title: string; lang?: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  const run = async () => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setState({ status: "loading" });
    try {
      const result = await fetchInsights(title, lang, ac.signal);
      if (!result.enabled) setState({ status: "error", message: "AI analysis is not configured on this server." });
      else setState({ status: "done", insights: result.insights });
    } catch (err) {
      if (ac.signal.aborted) return;
      setState({ status: "error", message: err instanceof ApiError ? err.message : "Analysis failed." });
    }
  };

  return (
    <section className={styles.insights} aria-labelledby="insights-heading" data-testid="insights">
      <div className={styles.asideHead}>
        <h2 id="insights-heading" className="label">
          Analysis
        </h2>
        <span className={`label ${styles.aiTag}`}>AI-generated</span>
      </div>
      <p className={styles.disclosure}>
        Written by a language model from this article&rsquo;s text only. Each point quotes the passage it relies on;
        points whose quote could not be found in the article are discarded. It can still misread the source.
      </p>

      {state.status === "idle" ? (
        <button type="button" className="btn" onClick={run}>
          Generate analysis
        </button>
      ) : null}
      {state.status === "loading" ? <p className="label">Reading the article…</p> : null}
      {state.status === "error" ? (
        <div className={styles.insightError} role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn" onClick={run}>
            Try again
          </button>
        </div>
      ) : null}
      {state.status === "done" ? <InsightsView insights={state.insights} lang={lang} /> : null}
    </section>
  );
}

function InsightsView({ insights, lang }: { insights: Insights; lang: string }) {
  return (
    <div className={styles.insightBody}>
      <div className={styles.complexity}>
        <span className="label">Technical depth</span>
        <span className={styles.complexityScale} aria-label={`${insights.complexity} out of 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={n <= insights.complexity ? styles.on : undefined} />
          ))}
        </span>
      </div>
      {insights.complexityRationale ? <p className={styles.insightText}>{insights.complexityRationale}</p> : null}

      {insights.whyInteresting.length ? (
        <div>
          <h3 className="label">Why it&rsquo;s interesting</h3>
          <ul className={styles.insightList}>
            {insights.whyInteresting.map((w, i) => (
              <li key={i}>
                {w.point} <Evidence quote={w.evidence} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insights.prerequisites.length ? (
        <div>
          <h3 className="label">Helps to know first</h3>
          <ul className={styles.insightList}>
            {insights.prerequisites.map((p, i) => (
              <li key={i}>
                {p.linked ? <Link href={articlePath(p.linked, undefined, lang)}>{p.concept}</Link> : p.concept}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insights.terms.length ? (
        <div>
          <h3 className="label">Terminology, explained</h3>
          <dl className={styles.insightTerms}>
            {insights.terms.map((t, i) => (
              <div key={i}>
                <dt>{t.term}</dt>
                <dd>
                  {t.explanation} <Evidence quote={t.evidence} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {insights.readNext.length ? (
        <div>
          <h3 className="label">Read next</h3>
          <ul className={styles.insightList}>
            {insights.readNext.map((r) => (
              <li key={r.title}>
                <Link href={articlePath(r.title, undefined, lang)}>{r.title}</Link>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="label">
        {insights.model}
        {insights.rejected ? ` · ${insights.rejected} unverifiable point${insights.rejected === 1 ? "" : "s"} removed` : ""}
      </p>
    </div>
  );
}
