import { expect, test, type Page } from "@playwright/test";
import { clippedElements, expectNoHorizontalOverflow } from "./helpers";

/** The Hacker News section against live Hacker News and Wikipedia. */

async function waitForHoles(page: Page) {
  // Cold start ingests Hacker News and builds the first rabbit holes; the feed refreshes itself.
  await expect(page.getByTestId("hn-item").first()).toBeVisible({ timeout: 80_000 });
}

test.describe("Hacker News", () => {
  test.describe.configure({ timeout: 150_000 });

  test("feed renders real submissions with Wikipedia context and source links", async ({ page }) => {
    await page.goto("/hackernews");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hacker News");
    await expect(page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Hacker News", exact: true })).toHaveAttribute("aria-current", "page");
    await waitForHoles(page);
    const items = page.getByTestId("hn-item");
    const first = items.first();
    await expect(first.getByRole("link", { name: /Discussion on Hacker News/ })).toHaveAttribute("href", /^https:\/\/news\.ycombinator\.com\/item\?id=\d+$/);
    await expect(first).toContainText(/\d+ Wikipedia articles/);
    await expect(first.getByRole("link", { name: "Open rabbit hole" })).toHaveAttribute("href", /^\/hackernews\/\d+$/);
    const ids = await items.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id));
    expect(new Set(ids).size).toBe(ids.length);
    await page.screenshot({ path: "test-results/hn-feed-desktop.png", fullPage: false });
  });

  test("a submission opens its rabbit hole with a working graph and reader links", async ({ page }) => {
    await page.goto("/hackernews");
    await waitForHoles(page);
    const first = page.getByTestId("hn-item").first();
    const title = (await first.getByRole("heading").textContent())!.trim();
    await first.getByRole("heading").getByRole("link").click();
    await expect(page).toHaveURL(/\/hackernews\/\d+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

    await expect(page.getByTestId("hn-source").getByRole("link", { name: /Discussion on Hacker News/ })).toHaveAttribute("href", /news\.ycombinator\.com\/item\?id=\d+/);
    const primary = page.getByTestId("primary-article");
    await expect(primary).toBeVisible();
    const read = primary.getByRole("link", { name: "Read in WikiHole" });
    await expect(read).toHaveAttribute("href", /^\/wiki\/.+/);
    // The primary article really exists on Wikipedia, and nothing here links out to it.
    const href = (await read.getAttribute("href"))!;
    const ua = process.env.WIKIMEDIA_USER_AGENT || "WikiHole-e2e/1.0 (test suite)";
    const summary = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${href.split("/wiki/")[1]}`, {
      headers: { "User-Agent": ua, "Api-User-Agent": ua },
      signal: AbortSignal.timeout(15_000),
    });
    expect(summary.status).toBe(200);

    const graph = page.getByTestId("knowledge-graph");
    await expect(graph).toBeVisible();
    const before = await graph.getByTestId("graph-node").count();
    expect(before).toBeGreaterThanOrEqual(3);
    // Go to the deepest level this hole has (levels without articles are disabled).
    const depthButtons = page.getByRole("group", { name: "Exploration depth" }).getByRole("button");
    const enabled = await depthButtons.evaluateAll((els) => els.filter((e) => !(e as HTMLButtonElement).disabled).map((e) => e.textContent?.trim()));
    expect(enabled.length).toBeGreaterThanOrEqual(3);
    await depthButtons.filter({ hasText: enabled[enabled.length - 1] }).click();
    await expect.poll(() => graph.getByTestId("graph-node").count()).toBeGreaterThan(before);
    // SVG nodes sit close together; dispatch the click to the node itself rather than to a point on screen.
    await graph.getByTestId("graph-node").nth(2).dispatchEvent("click");
    await expect(page.getByTestId("graph-detail")).toBeVisible();
    await expect(page.getByTestId("hole-article").first()).toBeVisible();
    for (const region of [primary, page.getByTestId("graph-detail"), page.getByTestId("hole-article")]) {
      await expect(region.locator('a[href*="wikipedia.org"]')).toHaveCount(0);
    }
    await page.screenshot({ path: "test-results/hn-exploration-desktop.png", fullPage: true });
    await graph.screenshot({ path: "test-results/hn-graph-desktop.png" });

    // Reader links lead into the WikiHole reader.
    await page.getByTestId("hole-article").first().getByRole("heading").getByRole("link").click();
    await expect(page).toHaveURL(/\/wiki\/.+/);
    await expect(page.getByTestId("article-section").first()).toBeVisible({ timeout: 30_000 });
  });

  test("handles unknown and unsuitable items", async ({ page }) => {
    // The loading boundary streams the page, so a missing item renders the not-found page (status already sent).
    await page.goto("/hackernews/999999999");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found", { timeout: 30_000 });
    // Item 1 is the very first Hacker News submission ("Y Combinator"), which names nothing to look up.
    await page.goto("/hackernews/1");
    await expect(page.locator("main")).toContainText(/Y Combinator/);
  });

  test("mobile layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/hackernews");
    await waitForHoles(page);
    await expectNoHorizontalOverflow(page);
    expect(await clippedElements(page)).toEqual([]);
    // On phones the main menu (with the Hacker News entry) folds into the header dropdown.
    await expect(page.locator("summary[aria-label='Main menu']")).toBeVisible();
    await page.screenshot({ path: "test-results/hn-feed-mobile.png" });
    await page.getByTestId("hn-item").first().getByRole("heading").getByRole("link").click();
    await expect(page.getByTestId("knowledge-graph")).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalOverflow(page);
    expect(await clippedElements(page)).toEqual([]);
    await page.screenshot({ path: "test-results/hn-exploration-mobile.png", fullPage: true });
  });
});
