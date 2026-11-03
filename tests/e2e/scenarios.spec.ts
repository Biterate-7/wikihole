import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, waitForFeed, wikipediaIntro, wikipediaSummary } from "./helpers";

test.describe("A: discover feed", () => {
  test("loads a feed of real, unique Wikipedia articles", async ({ page }) => {
    await page.goto("/discover");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The internet’s deepest rabbit holes.");
    await waitForFeed(page);
    const items = page.getByTestId("feed-item");
    expect(await items.count()).toBeGreaterThanOrEqual(8);

    const titles = await items.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.title ?? ""));
    expect(new Set(titles).size).toBe(titles.length);

    // Every item links to its Wikipedia source.
    const sources = await page.locator('[data-testid=feed-item] a[href^="https://en.wikipedia.org/wiki/"]').count();
    expect(sources).toBe(titles.length);

    // Descriptions are Wikipedia's own intro text (TextExtracts), not generated copy.
    for (const index of [0, 1, 2]) {
      const item = items.nth(index);
      const title = (await item.getAttribute("data-title"))!;
      const shown = (await item.locator("p").filter({ hasNotText: /min read/i }).last().textContent())!.trim();
      expect(shown).not.toContain("\\displaystyle");
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 60);
      expect(norm(shown)).toBe(norm(await wikipediaIntro(title)));
      expect((await wikipediaSummary(title)).type).toBe("standard");
    }
  });

  test("topic filters and new batches load different real articles", async ({ page }) => {
    await page.goto("/discover");
    await waitForFeed(page);
    const before = await page.getByTestId("feed-item").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.title));
    await page.getByRole("button", { name: "Mathematics", exact: true }).click();
    await expect(page).toHaveURL(/topic=mathematics/);
    await expect(page.getByTestId("feed-item").first()).toBeVisible();
    await expect(page.getByTestId("feed-item").first().locator(".label").first()).toContainText(/Mathematics/i);
    await page.getByRole("group", { name: "Mathematics subtopics" }).getByRole("button", { name: "Topology", exact: true }).click();
    await expect(page.getByTestId("feed-item").first().locator(".label").first()).toContainText(/Topology/i);

    await page.getByRole("button", { name: /New batch/ }).click();
    await expect(page.getByTestId("feed-item").first()).toBeVisible();
    const after = await page.getByTestId("feed-item").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.title));
    expect(after.filter((t) => before.includes(t))).toEqual([]);
  });

  test("infinite scroll appends more unique articles", async ({ page }) => {
    await page.goto("/discover");
    await waitForFeed(page);
    const first = await page.getByTestId("feed-item").count();
    await page.getByTestId("feed-item").last().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 4000);
    await expect.poll(async () => page.getByTestId("feed-item").count(), { timeout: 45_000 }).toBeGreaterThan(first);
    const titles = await page.getByTestId("feed-item").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.title));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

test.describe("B: search", () => {
  test("finds the Halting problem on Wikipedia and opens the reader", async ({ page }) => {
    await page.goto("/");
    const box = page.getByRole("combobox", { name: "Search English Wikipedia" });
    await box.fill("halting problem");
    const option = page.getByRole("option", { name: /^Halting problem/ });
    await expect(option).toBeVisible();
    await expect(option).toContainText("Problem in computer science");
    await box.press("ArrowDown");
    await expect(page.getByRole("listbox", { name: "Search results" }).getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/wiki\/Halting_problem$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Halting problem");
    await expect(page.getByTestId("article-section").first()).toBeVisible();
  });

  test("header search opens with the keyboard and closes with Escape", async ({ page }) => {
    await page.goto("/topics");
    await page.keyboard.press("/");
    const dialog = page.getByRole("dialog", { name: "Search Wikipedia" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").fill("turing machine");
    await expect(dialog.getByRole("option", { name: /^Turing machine/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("full results page shows Wikipedia snippets", async ({ page }) => {
    await page.goto("/search?q=kolmogorov%20complexity");
    const results = page.getByTestId("search-results").getByRole("listitem");
    await expect(results.first()).toBeVisible();
    await expect(results.first().getByRole("heading")).toHaveText("Kolmogorov complexity");
    await expect(results.first().locator("mark").first()).toBeVisible();
  });
});

test.describe("C: article reading", () => {
  test("renders sections, math, source links and related articles", async ({ page }) => {
    await page.goto("/wiki/Halting_problem");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Halting problem");
    expect(await page.getByTestId("article-section").count()).toBeGreaterThan(5);
    await expect(page.getByRole("heading", { level: 2, name: "History" })).toBeVisible();
    expect(await page.locator(".katex").count()).toBeGreaterThan(3);

    const source = page.getByTestId("source-link");
    await expect(source).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Halting_problem");
    const response = await page.request.head("https://en.wikipedia.org/wiki/Halting_problem");
    expect(response.ok()).toBe(true);

    await expect(page.getByRole("navigation", { name: "Article contents" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Key concepts" })).toBeVisible();
    await expect(page.getByTestId("related-item").first()).toBeVisible({ timeout: 45_000 });
    expect(await page.getByTestId("related-item").count()).toBeGreaterThanOrEqual(6);
    await expect(page.getByTestId("related-item").first().locator(".label").first()).toHaveText(/Listed under See also|Linked from the introduction|Linked in|Shares category|Textually similar/);
  });

  test("works on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/wiki/Enigma_machine");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Enigma machine");
    await expect(page.getByTestId("article-section").first()).toBeVisible();
    await expect(page.locator("details summary", { hasText: "Contents" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Article contents" })).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test("redirects alias titles to the canonical article", async ({ page }) => {
    await page.goto("/wiki/Halting_Problem");
    await expect(page).toHaveURL(/\/wiki\/Halting_problem$/);
  });
});

test.describe("D: rabbit hole", () => {
  test("following related articles builds a trail; back navigation unwinds it", async ({ page }) => {
    await page.goto("/wiki/Halting_problem");
    const related = page.getByTestId("related-item").first();
    await expect(related).toBeVisible({ timeout: 45_000 });
    const nextTitle = (await related.getByRole("heading").textContent())!.replace(/Visited$/, "").trim();
    await related.getByRole("heading").getByRole("link").click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(nextTitle);
    const trail = page.getByTestId("trail");
    await expect(trail).toContainText("depth 2");
    await expect(trail.getByRole("listitem")).toHaveText(["Halting problem", nextTitle]);

    // Go one level deeper via an in-article link.
    const inline = page.locator("#article-body a[data-wiki-link]").first();
    const third = (await inline.getAttribute("href"))!;
    await inline.click();
    await expect(page).toHaveURL(new RegExp(third.replace(/[()]/g, "\\$&") + "$"));
    await expect(trail).toContainText("depth 3");

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(nextTitle);
    await expect(trail.getByRole("listitem")).toHaveText(["Halting problem", nextTitle]);

    await trail.getByRole("link", { name: "Halting problem" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Halting problem");
    await expect(trail.getByRole("listitem")).toHaveText(["Halting problem"]);

    // History recorded every visit; trails are listed in the library.
    await page.goto("/saved?tab=history");
    await expect(page.getByTestId("history-list").getByRole("link", { name: nextTitle })).toBeVisible();
    await page.getByRole("tab", { name: /Trails/ }).click();
    await expect(page.getByRole("link", { name: "Resume exploration" }).first()).toBeVisible();
  });

  test("hides articles already on the trail from suggestions", async ({ page }) => {
    await page.goto("/wiki/Halting_problem");
    const first = page.getByTestId("related-item").first();
    await expect(first).toBeVisible({ timeout: 45_000 });
    await first.getByRole("heading").getByRole("link").click();
    await expect(page.getByTestId("trail")).toContainText("depth 2");
    await expect(page.getByTestId("related-item").first()).toBeVisible({ timeout: 45_000 });
    const titles = await page.getByTestId("related-item").getByRole("heading").allTextContents();
    expect(titles.map((t) => t.replace(/Visited$/, ""))).not.toContain("Halting problem");
  });
});

test.describe("E: random discovery", () => {
  test("selects a real, filtered article and offers another", async ({ page }) => {
    await page.goto("/random");
    const card = page.getByTestId("random-discovery");
    await expect(card).toBeVisible({ timeout: 60_000 });
    const title = (await card.getByRole("heading", { level: 2 }).textContent())!;
    await expect(page.getByTestId("random-stats")).toContainText(/uniformly random pages/);
    await expect(page.getByTestId("random-stats")).toContainText(/passed the quality gate/);

    const summary = await wikipediaSummary(title);
    expect(summary.type).toBe("standard");
    expect(summary.extract.length).toBeGreaterThan(80);

    await page.getByRole("button", { name: /Another discovery/ }).click();
    await expect(card.getByRole("heading", { level: 2 })).not.toHaveText(title, { timeout: 60_000 });
    await expect(card.getByRole("link", { name: /Explore deeper/ })).toHaveAttribute("href", /#rabbit-hole$/);
  });
});

test.describe("F: saved articles", () => {
  test("persist across reloads and can be removed", async ({ page }) => {
    await page.goto("/wiki/Busy_beaver");
    const save = page.locator("header").getByTestId("save-button").first();
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.locator("header").getByTestId("save-button").first()).toHaveAttribute("aria-pressed", "true");

    await page.goto("/saved");
    const item = page.getByTestId("saved-item").filter({ hasText: "Busy beaver" });
    await expect(item).toBeVisible();
    await page.reload();
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: /Remove Busy beaver/ }).click();
    await expect(page.getByTestId("saved-item")).toHaveCount(0);
    await expect(page.getByText("You haven't saved anything yet.")).toBeVisible();
  });

  test("survives corrupted local data", async ({ page }) => {
    await page.goto("/saved");
    await page.evaluate(() => {
      localStorage.setItem("wikihole:v1:saved", "{definitely not json");
      localStorage.setItem("wikihole:v1:history", JSON.stringify([{ title: 5 }, { title: "Halting problem", visitedAt: 1 }]));
    });
    await page.reload();
    await expect(page.getByText("You haven't saved anything yet.")).toBeVisible();
    await page.getByRole("tab", { name: /History/ }).click();
    await expect(page.getByTestId("history-list").getByRole("link")).toHaveText(["Halting problem"]);
  });
});
