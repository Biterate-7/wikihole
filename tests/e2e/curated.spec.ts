import { expect, test } from "@playwright/test";
import { clippedElements, expectNoHorizontalOverflow, VIEWPORTS } from "./helpers";

/** The human-curated and catalogue discovery pages, against the published snapshot and live Wikipedia. */

test.describe("Recommended", () => {
  test("is reached from Discover and shows ranked articles with traceable evidence", async ({ page }) => {
    await page.goto("/discover");
    await page.getByRole("navigation", { name: "Views" }).getByRole("link", { name: "Recommended" }).click();
    await expect(page).toHaveURL(/\/discover\/recommended/);
    await expect(page.getByRole("heading", { level: 1, name: "Recommended" })).toBeVisible();

    const first = page.getByTestId("curated-item").first();
    await expect(first).toBeVisible();
    await expect(first.getByTestId("curated-count")).toContainText(/\d+ recommendation/);
    await first.getByRole("button", { name: "Why people recommend it" }).click();
    const quote = first.getByTestId("curated-evidence").first();
    await expect(quote).toBeVisible();
    const href = await quote.getByRole("link").first().getAttribute("href");
    expect(href).toMatch(/^https:\/\//);
  });

  test("switches collection and keeps a shareable URL", async ({ page }) => {
    await page.goto("/discover/recommended");
    await expect(page.getByTestId("curated-item").first()).toBeVisible();
    await page.getByRole("button", { name: "Hidden gems" }).click();
    await expect(page).toHaveURL(/c=hidden/);
    await expect(page.getByRole("button", { name: "Hidden gems" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("curated-item").first()).toBeVisible();

    await page.goto("/discover/recommended?c=evergreen");
    await expect(page.getByRole("button", { name: "Evergreen" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("curated-item").first()).toBeVisible();
  });

  test("states where the evidence comes from, including what is unavailable", async ({ page }) => {
    await page.goto("/discover/recommended");
    const tools = page.locator("#page-tools");
    await expect(tools.getByTestId("evidence-totals")).toContainText(/qualifying recommendations/);
    await expect(tools.getByText(/Reddit \(not available\)/)).toBeVisible();
    await expect(tools.getByTestId("evaluation-summary")).toContainText(/held-out/);
  });

  test("From your reading uses local history and opens from a read article", async ({ page }) => {
    await page.goto("/wiki/Great_Stink");
    await expect(page.getByTestId("reader")).toBeVisible();
    await page.goto("/discover/recommended?c=for-you");
    await expect(page.getByRole("button", { name: "From your reading" })).toHaveAttribute("aria-pressed", "true");
    const feed = page.getByTestId("curated-feed");
    await expect(feed.getByTestId("feed-item").first().or(feed.getByText("Nothing to go on yet."))).toBeVisible({ timeout: 45_000 });
  });

  test("article pages keep their structure and add evidence only in the tools column", async ({ page }) => {
    await page.goto("/wiki/Great_Stink");
    await expect(page.getByTestId("reader")).toBeVisible();
    const note = page.locator("#page-tools").getByTestId("article-recommendation");
    await expect(note).toContainText(/recommendation/);
    await expect(page.locator("#article-body").getByTestId("article-recommendation")).toHaveCount(0);
  });
});

test.describe("Explore Wikipedia", () => {
  test("browses the catalogue, including articles nobody recommended", async ({ page }) => {
    await page.goto("/discover/explore");
    await expect(page.getByRole("heading", { level: 1, name: "Explore Wikipedia" })).toBeVisible();
    await expect(page.getByTestId("curated-item").first()).toBeVisible();
    await expect(page.getByTestId("catalogue-totals")).toContainText(/articles/);

    await page.getByRole("button", { name: "Not yet recommended" }).click();
    await expect(page).toHaveURL(/new=1/);
    const first = page.getByTestId("curated-item").first();
    await expect(first).toBeVisible();
    await expect(first.getByTestId("curated-count")).toHaveCount(0);
    await first.getByRole("button", { name: "Wikipedia signals" }).click();
    await expect(first.getByText(/articles link here|last month|Topics:/).first()).toBeVisible();
  });

  test("filters by text, area and order", async ({ page }) => {
    await page.goto("/discover/explore");
    await page.getByRole("searchbox", { name: "Find:" }).fill("volcano");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/q=volcano/);
    await expect(page.getByTestId("curated-item").first()).toBeVisible();

    await page.goto("/discover/explore?area=STEM&sort=quiet");
    await expect(page.getByRole("button", { name: "Science and technology" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Quietest" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("curated-item").first()).toBeVisible();
  });
});

test.describe("existing discovery stays reachable", () => {
  test("Discover, Topics and Random still work from the new pages", async ({ page }) => {
    await page.goto("/discover/recommended");
    const views = page.getByRole("navigation", { name: "Views" });
    await expect(views.getByRole("link", { name: "Topics" })).toHaveAttribute("href", "/topics");
    await expect(views.getByRole("link", { name: "Random" })).toHaveAttribute("href", "/random");
    await views.getByRole("link", { name: "Discover", exact: true }).click();
    await expect(page.getByTestId("feed-item").first()).toBeVisible({ timeout: 45_000 });
  });

  test("another edition gets the notice and a way back", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "wikihole-lang", value: "de", url: baseURL! }]);
    await page.goto("/discover/recommended");
    await expect(page.getByTestId("curated-item").first()).toBeVisible();
    await expect(page.getByTestId("edition-notice")).toContainText("public discussions");
  });
});

test.describe("responsive", () => {
  for (const viewport of VIEWPORTS) {
    test(`new pages fit at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of ["/discover/recommended", "/discover/explore"]) {
        await page.goto(path);
        await expect(page.getByTestId("curated-item").first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
        expect(await clippedElements(page), `clipped on ${path}`).toEqual([]);
      }
    });
  }
});

test.describe("recommended is not the same as mentioned", () => {
  test("an article people mostly cite does not lead the list, and its citations are shown as such", async ({ request }) => {
    const page = await (await request.get("/api/curated?collection=most&limit=30")).json();
    const titles = page.items.map((item: { title: string }) => item.title);
    for (const cited of ["Betteridge's law of headlines", "Goodhart's law", "Poe's law"]) expect(titles).not.toContain(cited);
    for (const item of page.items) {
      expect(item.recommendation.qualifying).toBeGreaterThanOrEqual(3);
      expect(item.recommendation.evidence.length).toBeGreaterThan(0);
      expect(item.recommendation.evidence[0].url).toMatch(/^https:/);
    }
  });
});
