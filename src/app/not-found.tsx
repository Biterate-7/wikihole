import Link from "next/link";
import styles from "./pages.module.css";

export default function NotFound() {
  return (
    <div className={`container ${styles.narrow}`}>
      <div className={styles.pageHead}>
        <p className="label">404</p>
        <h1 className={styles.pageTitle}>This hole goes nowhere.</h1>
        <p className={styles.pageSub}>The page you were looking for does not exist.</p>
        <p style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href="/">
            Back to discoveries
          </Link>
          <Link className="btn" href="/random">
            Random article
          </Link>
        </p>
      </div>
    </div>
  );
}
