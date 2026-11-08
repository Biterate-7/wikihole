import { expect, test } from "@playwright/test";

/**
 * Readers do not leave WikiHole for Wikipedia. Checked on rendered pages, after
 * hydration and client-side loading, because links can be built at runtime and
 * so slip past a search of the source.
 */

const PAGES = [
  "/",
  "/discover",
  "/discover/explore",
  "/topics",
  "/topics/computer-science",
  "/search?q=enigma%20machine",
  "/random",
  "/saved",
  "/wiki/Enigma_machine",
  "/de/wiki/Turingmaschine",
  "/history/Enigma_machine",
  "/history/Enigma_machine?from=1381391950&to=1381401534",
];

test.describe("no outbound Wikipedia links", () => {
  for (const path of PAGES) {
    test(path, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeAttached();
      // Let streamed and client-loaded content arrive. Some pages keep polling, so this is bounded.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const links = await page.locator('a[href*="wikipedia.org"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      expect(links).toEqual([]);
    });
  }
});
