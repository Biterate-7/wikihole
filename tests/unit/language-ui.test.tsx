// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageMenu } from "@/components/i18n/LanguageMenu";
import { LanguageProvider, useLanguage } from "@/components/i18n/LanguageProvider";
import { SearchLanguageSelect } from "@/components/i18n/SearchLanguageSelect";
import { LanguageRing } from "@/components/home/LanguageRing";
import { SearchBox } from "@/components/search/SearchBox";
import {
  advanceTrail,
  currentTrailStore,
  historyStore,
  isSaved,
  recordVisit,
  removeSaved,
  savedStore,
  toggleSaved,
  trailsStore,
} from "@/lib/storage/collections";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function mockFetch(handler: (url: string) => unknown) {
  const fn = vi.fn(async (input: string) =>
    new Response(JSON.stringify(handler(input)), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** The search field (the edition <select> is a combobox too). */
const searchInput = () => screen.getByRole("combobox", { name: /^Search .+ Wikipedia$/ });

function ActiveLanguage() {
  return <output data-testid="active">{useLanguage().lang}</output>;
}

const clearCookie = () => {
  document.cookie = "wikihole-lang=; Path=/; Max-Age=0";
};

beforeEach(() => {
  push.mockReset();
  clearCookie();
  localStorage.clear();
  sessionStorage.clear();
  for (const store of [savedStore, historyStore, trailsStore, currentTrailStore]) store.reset();
});
afterEach(() => cleanup());

describe("LanguageProvider", () => {
  it("starts from the server's choice, ignores unknown codes, and persists changes in a cookie", async () => {
    const { unmount } = render(
      <LanguageProvider initialLang="nonsense">
        <ActiveLanguage />
        <SearchLanguageSelect />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("active").textContent).toBe("en");
    await userEvent.setup().selectOptions(screen.getByTestId("search-language"), "fr");
    expect(screen.getByTestId("active").textContent).toBe("fr");
    expect(document.cookie).toContain("wikihole-lang=fr");
    unmount();

    // A later visit: the server reads the cookie and hands it back as the initial language.
    render(
      <LanguageProvider initialLang="fr">
        <ActiveLanguage />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("active").textContent).toBe("fr");
  });
});

describe("LanguageRing", () => {
  it("lists the featured editions with their counts and selects one", async () => {
    render(
      <LanguageProvider initialLang="en">
        <input id="portal-search-input" aria-label="search" />
        <LanguageRing counts={{ en: "7,254,000+ articles", ja: "1,523,000+ 記事" }} />
        <ActiveLanguage />
      </LanguageProvider>,
    );
    const entries = screen.getAllByTestId("featured-language");
    expect(entries.map((e) => e.dataset.lang)).toEqual(["en", "ja", "de", "fr", "ru", "es", "it", "zh", "pt", "pl"]);
    expect(entries[1].textContent).toContain("1,523,000+ 記事");
    expect(screen.getByRole("button", { name: /English/ }).getAttribute("aria-pressed")).toBe("true");

    await userEvent.setup().click(screen.getByRole("button", { name: /日本語/ }));
    expect(screen.getByTestId("active").textContent).toBe("ja");
    expect(screen.getByRole("button", { name: /日本語/ }).getAttribute("aria-pressed")).toBe("true");
    // Focus moves to the search field, ready to search that edition.
    expect(document.activeElement?.id).toBe("portal-search-input");
  });
});

describe("LanguageMenu", () => {
  it("loads live counts, groups and filters languages, selects by keyboard and returns to English", async () => {
    const fetchMock = mockFetch(() => ({
      languages: [
        { code: "en", articles: 7254000 },
        { code: "de", articles: 3159000 },
        { code: "eu", articles: 450000 },
        { code: "la", articles: 140000 },
        { code: "ka", articles: null },
      ],
    }));
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLang="en">
        <LanguageMenu />
        <ActiveLanguage />
      </LanguageProvider>,
    );
    const toggle = screen.getByTestId("language-menu-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/languages");

    await screen.findByRole("heading", { name: "1,000,000+ articles" });
    expect(screen.getByRole("heading", { name: "100,000+ articles" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Article count unavailable" })).toBeTruthy();

    // The filter has focus; match English names and native names alike.
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Find a language"));
    await user.keyboard("basque");
    const options = screen.getAllByRole("button", { pressed: false }).filter((b) => b.dataset.lang);
    expect(options.map((o) => o.dataset.lang)).toEqual(["eu"]);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("active").textContent).toBe("eu");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Return to English" }));
    expect(screen.getByTestId("active").textContent).toBe("en");

    await user.click(toggle);
    await user.keyboard("{Escape}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    // Counts are fetched once per page view.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still lists every language when counts cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    render(
      <LanguageProvider initialLang="en">
        <LanguageMenu />
      </LanguageProvider>,
    );
    await userEvent.setup().click(screen.getByTestId("language-menu-toggle"));
    await screen.findByText(/Article counts are unavailable/);
    expect(screen.getByRole("heading", { name: "All languages" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /日本語/ })).toBeTruthy();
  });
});

describe("SearchBox in another edition", () => {
  it("queries and navigates in the active language", async () => {
    const fetchMock = mockFetch(() => ({ results: [{ pageId: 9, title: "Entropie", length: 9000, disambiguation: false }] }));
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLang="de">
        <SearchBox variant="portal" inputId="portal-search" />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("search-language")).toHaveProperty("value", "de");
    const input = searchInput();
    await user.type(input, "entropie");
    await screen.findByText("Entropie");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/search?q=entropie&lang=de");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(push).toHaveBeenCalledWith("/de/wiki/Entropie");
  });

  it("submits the full results page with the search button and ignores empty searches", async () => {
    mockFetch(() => ({ results: [] }));
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLang="ja">
        <SearchBox variant="portal" inputId="portal-search" />
      </LanguageProvider>,
    );
    const button = screen.getByRole("button", { name: "Search Japanese Wikipedia" });
    await user.click(button);
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(searchInput());

    await user.type(searchInput(), "量子");
    await user.click(button);
    expect(push).toHaveBeenCalledWith(`/search?q=${encodeURIComponent("量子")}&lang=ja`);
  });

  it("switches edition from the inline selector", async () => {
    const fetchMock = mockFetch(() => ({ results: [] }));
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLang="en">
        <SearchBox variant="portal" inputId="portal-search" />
      </LanguageProvider>,
    );
    await user.selectOptions(screen.getByTestId("search-language"), "pl");
    await user.type(searchInput(), "entropia");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/api/search?q=entropia&lang=pl");
  });
});

describe("language-aware storage", () => {
  it("keeps saved articles with the same title in different editions apart", () => {
    toggleSaved({ title: "Entropie", lang: "de" });
    toggleSaved({ title: "Entropie", lang: "fr" });
    expect(isSaved(savedStore.get(), "Entropie", "de")).toBe(true);
    expect(isSaved(savedStore.get(), "Entropie", "fr")).toBe(true);
    expect(isSaved(savedStore.get(), "Entropie")).toBe(false);
    removeSaved("Entropie", "de");
    expect(savedStore.get().map((s) => s.lang)).toEqual(["fr"]);
  });

  it("reads entries saved before languages existed as English", () => {
    localStorage.setItem("wikihole:v1:saved", JSON.stringify([{ title: "Halting problem", savedAt: 1 }]));
    expect(isSaved(savedStore.get(), "Halting problem", "en")).toBe(true);
    expect(isSaved(savedStore.get(), "Halting problem", "de")).toBe(false);
  });

  it("starts a new trail when the edition changes and records history per edition", () => {
    const en = advanceTrail(null, "Entropy", null, 1);
    expect(en.lang).toBeUndefined();
    expect(advanceTrail(en, "Entropy", null, 2, "en").id).toBe(en.id);
    const de = advanceTrail(en, "Entropie", "Entropy", 3, "de");
    expect(de.id).not.toBe(en.id);
    expect(de).toMatchObject({ steps: ["Entropie"], lang: "de" });

    act(() => {
      recordVisit("Entropie", undefined, "de");
      recordVisit("Entropie", undefined, "fr");
    });
    expect(historyStore.get().map((h) => [h.title, h.lang])).toEqual([
      ["Entropie", "fr"],
      ["Entropie", "de"],
    ]);
  });
});
