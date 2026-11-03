import { redirect } from "next/navigation";
import { Portal } from "@/components/home/Portal";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import { PageShell } from "@/components/layout/PageShell";
import { SiteTools } from "@/components/layout/SiteTools";
import { requestLanguage } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function HomePage({ searchParams }: Props) {
  // The Discover feed used to live at "/" with ?topic= and ?mode=; keep those links working.
  const params = await searchParams;
  const legacy = new URLSearchParams();
  for (const key of ["topic", "mode"]) {
    const value = params[key];
    if (typeof value === "string") legacy.set(key, value);
  }
  if (legacy.size > 0) redirect(`/discover?${legacy}`);
  const lang = await requestLanguage();
  return (
    <LanguageProvider initialLang={lang}>
      <PageShell
        title="Main Page"
        hideTitle
        tabs={{
          left: [
            { label: "Main Page", href: "/", selected: true },
            { label: "Languages", href: "/#languages" },
          ],
          right: [
            { label: "Read", href: "/", selected: true },
            { label: "Discover", href: "/discover" },
            { label: "View history", href: "/saved?tab=history" },
          ],
        }}
        tools={<SiteTools />}
      >
        <Portal lang={lang} />
      </PageShell>
    </LanguageProvider>
  );
}
