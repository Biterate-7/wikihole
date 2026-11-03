import { expect, test } from "@playwright/test";

/** Live article count of an edition, straight from that Wikipedia. */
async function liveArticleCount(lang: string): Promise<number> {
  const response = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&meta=siteinfo&siprop=statistics&format=json&formatversion=2`, {
    headers: { "User-Agent": process.env.WIKIMEDIA_USER_AGENT || "WikiHole-e2e/1.0" },
  });
  const json = (await response.json()) as { query: { statistics: { articles: number } } };
  return json.query.statistics.articles;
}

test.describe("I: homepage portal and languages", () => {
  test("shows the Main Page, the featured editions around the globe with live counts, search and the language menu", async ({ page }) => {
    await page.goto("/");
    // Like Wikipedia, the Main Page title is hidden and the welcome banner leads.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Main Page");
    await expect(page.getByText("Welcome to Wikihole,")).toBeVisible();
    await expect(page.getByRole("heading", { name: "From today’s featured discovery" })).toBeVisible();
    await expect(page.locator("#languages canvas, #languages img").first()).toBeVisible();
    const entries = page.getByTestId("featured-language");
    await expect(entries).toHaveCount(10);
    expect(await entries.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.lang))).toEqual([
      "en", "ja", "de", "fr", "ru", "es", "it", "zh", "pt", "pl",
    ]);

    // Counts are Wikipedia's own, rounded down to thousands.
    const shown = (await entries.first().locator("small").textContent())!;
    const live = await liveArticleCount("en");
    const digits = Number(shown.replace(/[^\d]/g, ""));
    expect(digits).toBeLessThanOrEqual(live);
    expect(live - digits).toBeLessThan(5000);
    await expect(entries.nth(2).locator("small")).toContainText("Artikel");

    await expect(page.getByRole("combobox", { name: "Search English Wikipedia" })).toBeVisible();
    await expect(page.getByTestId("language-menu-toggle")).toHaveText(/Explore Wikihole in your language/);
    // The site chrome is shared with every page: header, pinned main menu and tools.
    await expect(page.getByRole("navigation", { name: "Personal tools" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Tools" })).toBeVisible();
  });

  test("a chosen edition drives search, the reader and related articles, and survives a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("featured-language").filter({ hasText: "Deutsch" }).getByRole("button").click();
    const box = page.getByRole("combobox", { name: "Search German Wikipedia" });
    await expect(box).toBeFocused();
    await expect(page.getByTestId("search-language")).toHaveValue("de");

    await box.fill("Halteproblem");
    const option = page.getByRole("option", { name: /^Halteproblem/ });
    await expect(option).toBeVisible();
    await box.press("ArrowDown");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/de\/wiki\/Halteproblem$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Halteproblem");
    await expect(page.getByTestId("article-section").first()).toBeVisible();
    await expect(page.getByTestId("source-link")).toHaveAttribute("href", "https://de.wikipedia.org/wiki/Halteproblem");

    // In-article links and Rabbit Hole suggestions stay on German Wikipedia.
    const inline = await page.locator("#article-body a[data-wiki-link]").evaluateAll((els) => els.slice(0, 10).map((e) => e.getAttribute("href")));
    expect(inline.length).toBeGreaterThan(0);
    for (const href of inline) expect(href).toMatch(/^\/de\/wiki\//);
    const related = page.getByTestId("related-item");
    await expect(related.first()).toBeVisible({ timeout: 45_000 });
    const relatedHrefs = await related.locator("h3 a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    for (const href of relatedHrefs) expect(href).toMatch(/^\/de\/wiki\//);

    // Following one builds a German trail.
    const next = related.first().locator("h3 a");
    const nextTitle = (await next.textContent())!.trim();
    await next.click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(nextTitle);
    await expect(page.getByTestId("trail")).toContainText("depth 2");

    await page.goto("/");
    await page.reload();
    await expect(page.getByTestId("search-language")).toHaveValue("de");
    await page.goto("/search?q=Entropie");
    await expect(page.getByText(/articles on German Wikipedia/)).toBeVisible();
  });

  test("the language menu discovers more editions and returns to English", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByTestId("language-menu-toggle");
    await toggle.click();
    await expect(page.getByRole("heading", { name: "1,000,000+ articles" })).toBeVisible({ timeout: 45_000 });
    const filter = page.getByPlaceholder("Find a language");
    await expect(filter).toBeFocused();
    await filter.fill("basque");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("search-language")).toHaveValue("eu");

    await page.goto("/discover");
    await expect(page.getByTestId("edition-notice")).toContainText("Euskara");
    await page.getByTestId("edition-notice").getByRole("button", { name: "Switch to English" }).click();
    await expect(page.getByTestId("edition-notice")).toHaveCount(0);
    await expect(page.getByTestId("header-language")).toHaveValue("en");
  });

  test("legacy feed links, unknown editions and /en/ paths resolve sensibly", async ({ page }) => {
    await page.goto("/?topic=mathematics");
    await expect(page).toHaveURL(/\/discover\?topic=mathematics$/);
    const unknown = await page.goto("/xx/wiki/Entropy");
    expect(unknown?.status()).toBe(404);
    await page.goto("/en/wiki/Halting_problem");
    await expect(page).toHaveURL(/\/wiki\/Halting_problem$/);
  });
});
