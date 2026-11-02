"use client";

import Link from "next/link";
import { useEffect } from "react";
import styles from "./pages.module.css";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={`container ${styles.narrow}`}>
      <div className={styles.pageHead} role="alert">
        <p className="label">Error</p>
        <h1 className={styles.pageTitle}>Something broke on the way down.</h1>
        <p className={styles.pageSub}>
          This page failed to render. It is usually a temporary problem reaching Wikipedia.
          {error.digest ? ` Reference: ${error.digest}.` : ""}
        </p>
        <p style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={reset}>
            Try again
          </button>
          <Link className="btn" href="/">
            Back to discoveries
          </Link>
        </p>
      </div>
    </div>
  );
}
