import { PageShell } from "@/components/layout/PageShell";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading article">
      <PageShell start="toc" title={<span className="skeleton" style={{ display: "inline-block", width: "45%", height: 28, verticalAlign: "middle" }} />}>
        <div style={{ marginTop: 16 }}>
          <div className="skeleton" style={{ width: 260, height: 12, marginBottom: 24 }} />
          {[100, 96, 99, 90, 60, 0, 98, 94, 97, 72].map((w, i) => (
            <div key={i} className="skeleton" style={{ width: `${w}%`, height: w ? 14 : 8, marginBottom: 12, opacity: w ? 1 : 0 }} />
          ))}
        </div>
      </PageShell>
    </div>
  );
}
