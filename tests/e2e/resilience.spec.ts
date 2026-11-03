import { expect, test } from "@playwright/test";
import { VIEWPORTS, clippedElements, expectNoHorizontalOverflow, overlapping, waitForFeed } from "./helpers";

test.describe("G: failure handling", () => {
  test("feed API failure shows a recoverable error", async ({ page }) => {
    await page.goto("/discover");
    await waitForFeed(page);
    let fail = true;
    await page.route("**/api/feed", (route) =>
      fail
        ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Wikipedia is unavailable right now. Try again shortly." }) })
        : route.continue(),
    );
    await page.getByRole("button", { name: /New batch/ }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Wikipedia is unavailable" });
    await expect(alert).toBeVisible();
    fail = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await waitForFeed(page);
  });

  test("search API failure is reported inline", async ({ page }) => {
    await page.route("**/api/search**", (route) =>
      route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Wikipedia is unavailable right now. Try again shortly." }) }),
    );
    await page.goto("/topics");
    await page.keyboard.press("/");
    await page.getByRole("combobox", { name: "Search Wikipedia" }).fill("entropy");
    await expect(page.locator("header").getByText("Wikipedia is unavailable right now.")).toBeVisible();
  });

  test("empty search results", async ({ page }) => {
    await page.goto("/search?q=qzxvbnmlkjhgfdsapoiuytrewq");
    await expect(page.getByText(/No Wikipedia articles match/)).toBeVisible();
  });

  test("nonexistent and invalid articles return 404 pages", async ({ page }) => {
    const missing = await page.goto("/wiki/Zzqx_this_article_does_not_exist_9137");
    expect(missing?.status()).toBe(404);
    await expect(page.getByText("There is no Wikipedia article with that title.")).toBeVisible();
    const invalid = await page.goto("/wiki/%7Cbad%7Ctitle");
    expect(invalid?.status()).toBe(404);
  });

  test("unavailable thumbnails do not break the feed", async ({ page }) => {
    await page.route(/(thumb|upload)\.wikimedia\.org/, (route) => route.abort());
    await page.goto("/discover");
    await waitForFeed(page);
    await page.waitForTimeout(1000);
    const broken = await page.evaluate(() => [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).length);
    expect(broken).toBe(0);
    await expectNoHorizontalOverflow(page);
  });

  test("absent AI credentials hide AI features but keep deterministic insights", async ({ page, request }) => {
    const health = await (await request.get("/api/health")).json();
    test.skip(health.ai === true, "AI is configured in this environment");
    const insights = await request.post("/api/insights", { data: { title: "Halting problem" } });
    expect(await insights.json()).toEqual({ enabled: false });
    await page.goto("/wiki/Halting_problem");
    await expect(page.getByRole("heading", { name: "Key concepts" })).toBeVisible();
    await expect(page.getByTestId("insights")).toHaveCount(0);
  });

  test("API rejects malformed requests", async ({ request }) => {
    expect((await request.post("/api/feed", { data: "not json", headers: { "Content-Type": "application/json" } })).status()).toBe(400);
    expect((await request.post("/api/feed", { data: { topic: "celebrities" } })).status()).toBe(400);
    expect((await request.get(`/api/search?q=${"x".repeat(300)}`)).status()).toBe(400);
  });
});

test.describe("H: responsiveness", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name} ${vp.width}px: no overflow, clipping or overlapping controls`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      await page.goto("/");
      await expect(page.getByTestId("featured-language")).toHaveCount(10);
      await expectNoHorizontalOverflow(page);
      expect(await clippedElements(page)).toEqual([]);
      expect(
        await overlapping(page, "[data-testid=featured-language] button, form[role=search] button, [data-testid=language-menu-toggle]"),
      ).toBe(false);

      await page.goto("/discover");
      await waitForFeed(page);
      await expectNoHorizontalOverflow(page);
      expect(await clippedElements(page)).toEqual([]);
      expect(await overlapping(page, "header nav a, header nav button")).toBe(false);
      expect(await overlapping(page, "[data-testid=feed-item]:first-child button, [data-testid=feed-item]:first-child .action")).toBe(false);

      await page.goto("/wiki/Enigma_machine");
      await expect(page.getByTestId("article-section").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(await clippedElements(page)).toEqual([]);
      // Wide tables scroll inside their own container instead of the page.
      const tables = await page.evaluate(() =>
        [...document.querySelectorAll("table")].map((t) => {
          const wrap = t.parentElement!;
          return { fits: wrap.getBoundingClientRect().right <= window.innerWidth + 1, scrollable: getComputedStyle(wrap).overflowX === "auto" };
        }),
      );
      expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) expect(t).toEqual({ fits: true, scrollable: true });

      for (const path of ["/topics", "/topics/cryptography", "/random", "/saved"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle").catch(() => {});
        await expectNoHorizontalOverflow(page);
        expect(await clippedElements(page), path).toEqual([]);
      }
    });
  }

  test("core pages run without console errors or uncaught exceptions", async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(`console: ${m.text()}`);
    });
    for (const path of [
      "/",
      "/discover",
      "/topics",
      "/topics/cryptography",
      "/wiki/Kolmogorov_complexity",
      "/de/wiki/Kolmogorow-Komplexit%C3%A4t",
      "/random",
      "/saved",
      "/search?q=entropy",
    ]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
    }
    expect(problems).toEqual([]);
  });

  test("keyboard users get visible focus and a skip link", async ({ page }) => {
    await page.goto("/topics");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });
});
