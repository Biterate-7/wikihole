import { describe, expect, it } from "vitest";
import { CURATED_TRAILS } from "@/lib/trails/curated";
import { mwApi } from "@/lib/wikipedia/http";

/**
 * The curated trails' data-integrity guarantee, checked against live English
 * Wikipedia: every title is a real article (not a redirect or disambiguation
 * page), and each article links to the next one, directly or through one of
 * the next article's redirects. Run with `npm run test:live`.
 */
const live = process.env.LIVE_WIKIPEDIA === "1";

type Page = { title: string; missing?: boolean; pageprops?: { disambiguation?: string }; links?: Array<{ title: string }>; redirects?: Array<{ title: string }> };

async function pages(params: Record<string, string>): Promise<Page[]> {
  const raw = await mwApi({ action: "query", ...params });
  return (raw.query as { pages: Page[] }).pages;
}

describe.skipIf(!live)("curated trails on live Wikipedia", { timeout: 120000 }, () => {
  const titles = [...new Set(CURATED_TRAILS.flatMap((t) => t.titles))];

  it("use canonical article titles", async () => {
    const problems: string[] = [];
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50);
      const raw = await mwApi({ action: "query", titles: batch.join("|"), prop: "pageprops", ppprop: "disambiguation", redirects: true });
      const query = raw.query as { pages: Page[]; redirects?: Array<{ from: string; to: string }> };
      for (const r of query.redirects ?? []) problems.push(`${r.from} redirects to ${r.to}`);
      for (const p of query.pages) {
        if (p.missing) problems.push(`${p.title} is missing`);
        if (p.pageprops?.disambiguation !== undefined) problems.push(`${p.title} is a disambiguation page`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("only take steps that Wikipedia itself links", async () => {
    const unlinked: string[] = [];
    for (const trail of CURATED_TRAILS) {
      for (let i = 0; i < trail.titles.length - 1; i++) {
        const [from, to] = [trail.titles[i], trail.titles[i + 1]];
        const [target] = await pages({ titles: to, prop: "redirects", rdlimit: "max", rdnamespace: "0" });
        const spellings = [to, ...(target.redirects ?? []).map((r) => r.title)];
        let linked = false;
        for (let j = 0; j < spellings.length && !linked; j += 50) {
          const [source] = await pages({ titles: from, prop: "links", pllimit: "max", pltitles: spellings.slice(j, j + 50).join("|") });
          linked = (source.links ?? []).length > 0;
        }
        if (!linked) unlinked.push(`${from} → ${to}`);
      }
    }
    expect(unlinked).toEqual([]);
  });
});
