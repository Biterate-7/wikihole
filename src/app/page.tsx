import { redirect } from "next/navigation";
import { Portal } from "@/components/home/Portal";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
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
  return (
    <LanguageProvider initialLang={await requestLanguage()}>
      <Portal />
    </LanguageProvider>
  );
}
