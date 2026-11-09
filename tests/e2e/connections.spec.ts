import { expect, test } from "@playwright/test";
import { VIEWPORTS, clippedElements, expectNoHorizontalOverflow } from "./helpers";

/** Unexpected Connections against a production build and live Wikipedia. */

test.describe("Unexpected connections", () => {
  test("the Main Page shows a complete, interactive example trail", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/");
    const section = page.getByTestId("unexpected-connections");
    await expect(section.getByRole("heading", { name: "Go down a rabbit hole. Find something unexpected." })).toBeVisible();
    await expect(section.getByTestId("trail-route")).toHaveText(/Apollo 11.*ARPANET/);
    const cards = section.getByTestId("trail-card");
    await expect(cards).toHaveCount(5);
    await expect(cards.first()).toContainText("Start");
    await expect(cards.last()).toContainText("Destination");
    await expect(section.getByTestId("trail-payoff")).toContainText("1969");
    // Wikipedia's descriptions stream in after the trail itself.
    await expect(cards.nth(1)).toHaveAttribute("data-status", "ok", { timeout: 30_000 });

    // The trail streams in as HTML before React hydrates it; a click before then is not handled yet.
    const toggle = section.getByTestId("trail-connection").first().getByRole("button");
    await expect(async () => {
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
    }).toPass();
    await expect(section.getByTestId("trail-detail").first()).toBeVisible();

    await section.getByRole("button", { name: "V-2 rocket" }).click();
    await expect(section.getByTestId("trail-route")).toHaveText(/Apollo 11.*V-2 rocket/);
    await section.getByRole("button", { name: "Explore another trail" }).click();
    await expect(section.getByTestId("trail-route")).not.toHaveText(/^Apollo 11/);
    expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
  });

  test("a card opens the article in the reader", async ({ page }) => {
    await page.goto("/connections");
    await page.getByRole("link", { name: "Sputnik crisis", exact: true }).click();
    await expect(page).toHaveURL(/\/wiki\/Sputnik_crisis$/);
    await expect(page.getByTestId("reader")).toBeVisible();
  });

  test("a new trail starts from an intermediate article", async ({ page }) => {
    await page.goto("/connections?trail=moon-computer-to-microwave");
    await page.getByRole("link", { name: "Start a trail from Raytheon" }).click();
    await expect(page).toHaveURL(/from=Raytheon/);
    await expect(page.getByTestId("trail-route")).toHaveText(/Raytheon.*Tizard Mission/);
    await expect(page.getByTestId("trail-card").first()).toContainText("Raytheon");
  });

  test("unknown articles and trails get a clear message", async ({ page }) => {
    await page.goto("/connections?from=Qwxzzy_not_an_article_123");
    await expect(page.getByText(/Wikipedia has no article called/)).toBeVisible();
    await page.goto("/connections?trail=nope");
    await expect(page.getByText("That trail does not exist")).toBeVisible();
    await expect(page.getByTestId("trail-explorer")).toBeVisible();
  });

  for (const viewport of VIEWPORTS.filter((v) => v.name === "mobile" || v.name === "tablet")) {
    test(`fits a ${viewport.name} screen`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const path of ["/", "/connections"]) {
        await page.goto(path);
        await expect(page.getByTestId("trail-explorer").first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
        expect(await clippedElements(page)).toEqual([]);
      }
    });
  }
});
