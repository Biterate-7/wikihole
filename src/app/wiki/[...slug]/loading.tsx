import styles from "@/components/article/article.module.css";

export default function Loading() {
  return (
    <div className={`container ${styles.grid}`} aria-busy="true" aria-label="Loading article">
      <div className={styles.head}>
        <div className={styles.header}>
          <div className="skeleton" style={{ width: 180, height: 10, marginBottom: 18 }} />
          <div className="skeleton" style={{ width: "62%", height: 40, marginBottom: 14 }} />
          <div className="skeleton" style={{ width: "40%", height: 18, marginBottom: 20 }} />
          <div className="skeleton" style={{ width: 300, height: 10 }} />
        </div>
      </div>
      <div className={styles.prose}>
        {[100, 96, 99, 90, 60, 0, 98, 94, 97, 72].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: `${w}%`, height: w ? 15 : 10, marginBottom: 13, opacity: w ? 1 : 0 }} />
        ))}
      </div>
    </div>
  );
}
