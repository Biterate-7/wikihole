import { expect, type Page } from "@playwright/test";
import { cleanExtract } from "../../src/lib/wikipedia/text";

export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "small-laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Fails if the document scrolls horizontally. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

/** Elements that extend past the viewport (ignoring intentional horizontal scrollers). */
export async function clippedElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scrollers = (el: Element) => {
      for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
        const style = getComputedStyle(n);
        if (["auto", "scroll", "hidden"].includes(style.overflowX)) return true;
      }
      return false;
    };
    return [...document.querySelectorAll("main *, header *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1) && !scrollers(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 40)}`);
  });
}

/** Checks pairwise overlap between a set of sibling controls. */
export async function overlapping(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const rects = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return true;
      }
    return false;
  }, selector);
}

export async function waitForFeed(page: Page) {
  await expect(page.getByTestId("feed-item").first()).toBeVisible({ timeout: 45_000 });
}

/** Fetches the plain-text intro WikiHole displays (TextExtracts), straight from Wikipedia. */
export async function wikipediaIntro(title: string): Promise<string> {
  const ua = process.env.WIKIMEDIA_USER_AGENT || "WikiHole-e2e/1.0 (test suite)";
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "User-Agent": ua, "Api-User-Agent": ua } });
  const body = (await res.json()) as { query: { pages: Array<{ extract?: string }> } };
  return cleanExtract(body.query.pages[0]?.extract) ?? "";
}

/** Fetches Wikipedia's REST summary from the test process (for grounding checks). */
export async function wikipediaSummary(title: string): Promise<{ extract: string; type: string }> {
  const ua = process.env.WIKIMEDIA_USER_AGENT || "WikiHole-e2e/1.0 (test suite)";
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, {
    headers: { "User-Agent": ua, "Api-User-Agent": ua },
  });
  return (await res.json()) as { extract: string; type: string };
}
