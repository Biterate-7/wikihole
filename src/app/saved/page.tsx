import type { Metadata } from "next";
import { Suspense } from "react";
import { PageShell, SiteSub } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import { SavedView } from "@/components/saved/SavedView";

export const metadata: Metadata = {
  title: "Saved",
  description: "Your saved articles, reading history and rabbit-hole trails.",
  robots: { index: false },
};

export default function SavedPage() {
  return (
    <PageShell
      title="Your library"
      tabs={{
        left: [{ label: "Library", href: "/saved", selected: true }],
        right: [
          { label: "Read", href: "/saved", selected: true },
          { label: "Discover", href: "/discover" },
        ],
      }}
      tools={<SiteTools />}
    >
      <SiteSub>Stored only in this browser. No account, nothing sent to a server.</SiteSub>
      <Suspense fallback={<p className="label">Loading your library…</p>}>
        <SavedView />
      </Suspense>
    </PageShell>
  );
}
