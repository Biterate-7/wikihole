import Link from "next/link";
import { SearchBox } from "@/components/search/SearchBox";
import styles from "@/app/pages.module.css";

export default function ArticleNotFound() {
  return (
    <div className={`container ${styles.narrow}`}>
      <div className={styles.pageHead}>
        <p className="label">404 · Not on Wikipedia</p>
        <h1 className={styles.pageTitle}>There is no Wikipedia article with that title.</h1>
        <p className={styles.pageSub}>
          It may have been renamed, merged or deleted, or the link was mistyped. Search for it instead, or{" "}
          <Link href="/random" style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
            take a random discovery
          </Link>
          .
        </p>
        <div className={styles.searchBar}>
          <SearchBox variant="hero" />
        </div>
      </div>
    </div>
  );
}
