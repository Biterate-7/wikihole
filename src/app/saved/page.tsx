import type { Metadata } from "next";
import { Suspense } from "react";
import { SavedView } from "@/components/saved/SavedView";
import styles from "../pages.module.css";

export const metadata: Metadata = {
  title: "Saved",
  description: "Your saved articles, reading history and rabbit-hole trails.",
  robots: { index: false },
};

export default function SavedPage() {
  return (
    <div className={`container ${styles.narrow}`}>
      <header className={styles.pageHead}>
        <p className="label">Library</p>
        <h1 className={styles.pageTitle}>Saved articles and trails</h1>
        <p className={styles.pageSub}>Stored only in this browser. No account, nothing sent to a server.</p>
      </header>
      <Suspense fallback={<p className="label">Loading your library…</p>}>
        <SavedView />
      </Suspense>
    </div>
  );
}
