import { PageShell, SiteSub } from "@/components/layout/PageShell";

export default function Loading() {
  return (
    <PageShell title="Hacker News">
      <div aria-busy="true">
        <SiteSub>
          <span role="status">Digging the rabbit hole: extracting concepts, matching Wikipedia articles, following their links…</span>
        </SiteSub>
        <div className="skeleton" style={{ width: "70%", maxWidth: 640, height: 14, marginTop: 16 }} />
        <div className="skeleton" style={{ width: "90%", height: 12, marginTop: 24 }} />
        <div className="skeleton" style={{ width: "80%", height: 12, marginTop: 8 }} />
        <div className="skeleton" style={{ width: "60%", height: 12, marginTop: 8 }} />
        <div className="skeleton" style={{ width: "100%", height: 360, marginTop: 24 }} />
      </div>
    </PageShell>
  );
}
