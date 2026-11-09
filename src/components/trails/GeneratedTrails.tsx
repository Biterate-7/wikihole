"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StateMessage } from "@/components/ui/StateMessage";
import { ApiError, fetchTrails } from "@/lib/api-client";
import type { ResolvedTrail } from "@/lib/trails/types";
import { articlePath } from "@/lib/wikipedia/titles";
import { TrailExplorer } from "./TrailExplorer";
import styles from "./trails.module.css";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "disabled" }
  | { kind: "empty"; rejected: number }
  | { kind: "ready"; trails: ResolvedTrail[] };

/**
 * Asks the server for AI-proposed trails from an article no curated trail
 * passes through. The request is made from the browser (not during the page
 * render) so that crawlers following links never start a generation.
 */
export function GeneratedTrails({ title, others }: { title: string; others: ResolvedTrail[] }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchTrails(title, controller.signal)
      .then((response) => {
        if (!response.enabled) setState({ kind: "disabled" });
        else if (response.trails.length === 0) setState({ kind: "empty", rejected: response.rejected });
        else setState({ kind: "ready", trails: response.trails });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof ApiError ? error.message : "Something went wrong." });
      });
    return () => controller.abort();
  }, [title, attempt]);

  const reader = (
    <Link href={articlePath(title)} prefetch={false}>
      {title}
    </Link>
  );

  if (state.kind === "loading") {
    return (
      <div className={styles.generating} role="status" data-testid="trail-generating">
        <p>
          Looking for an unexpected trail from {reader}, then checking every step against Wikipedia. This can take up to
          a minute.
        </p>
        <div aria-hidden="true">
          {[92, 70, 84].map((w) => (
            <div key={w} className="skeleton" style={{ width: `${w}%`, height: 14, marginTop: 10 }} />
          ))}
        </div>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <StateMessage
        kind="error"
        title="The trail could not be built"
        action={
          <button type="button" className="btn" onClick={retry}>
            Try again
          </button>
        }
      >
        {state.message}
      </StateMessage>
    );
  }
  if (state.kind === "disabled" || state.kind === "empty") {
    return (
      <StateMessage kind="empty" title={`No verified trail starts from ${title} yet`}>
        <p>
          {state.kind === "empty"
            ? `The trails proposed for this article did not pass verification${state.rejected ? ` (${state.rejected} rejected)` : ""}: a step has to be a real article that the previous one links to in its text.`
            : "No hand-written trail passes through this article."}{" "}
          Read {reader} and follow its Rabbit hole, or try one of the trails below.
        </p>
      </StateMessage>
    );
  }
  return <TrailExplorer trails={[...state.trails, ...others]} />;
}
