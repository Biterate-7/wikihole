import styles from "@/components/exploration/exploration.module.css";

export default function Loading() {
  return (
    <div className="container" aria-busy="true">
      <div className={styles.source}>
        <p className="label" role="status">
          Digging the rabbit hole: extracting concepts, matching Wikipedia articles, following their links…
        </p>
        <div className="skeleton" style={{ width: "70%", maxWidth: 720, height: 30, marginTop: 14 }} />
        <div className="skeleton" style={{ width: 300, maxWidth: "100%", height: 11, marginTop: 16 }} />
      </div>
      <div className={styles.grid}>
        <div className={styles.main}>
          <div>
            <div className="skeleton" style={{ width: 220, height: 20, marginBottom: 16 }} />
            <div className="skeleton" style={{ width: "100%", height: 12, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: "85%", height: 12, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: "60%", height: 12 }} />
          </div>
          <div className="skeleton" style={{ width: "100%", height: 420 }} />
        </div>
      </div>
    </div>
  );
}
