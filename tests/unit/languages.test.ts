import { describe, expect, it } from "vitest";
import { parseArticle } from "@/lib/content/parse";
import {
  DEFAULT_LANGUAGE,
  FEATURED_LANGUAGES,
  allLanguages,
  formatArticleCount,
  getLanguage,
  isSupportedLanguage,
  languageAbbreviation,
  resolveLanguage,
  wikipediaDomain,
} from "@/lib/i18n/languages";
import { articlePath, searchPath, titleFromWikiHref, wikipediaUrl } from "@/lib/wikipedia/titles";

describe("language registry", () => {
  it("features the ten portal editions in reading order, with native names", () => {
    expect(FEATURED_LANGUAGES).toEqual(["en", "ja", "de", "fr", "ru", "es", "it", "zh", "pt", "pl"]);
    expect(FEATURED_LANGUAGES.map((code) => getLanguage(code).nativeName)).toEqual([
      "English",
      "日本語",
      "Deutsch",
      "Français",
      "Русский",
      "Español",
      "Italiano",
      "中文",
      "Português",
      "Polski",
    ]);
  });

  it("has unique codes, every featured edition, and more to discover", () => {
    const codes = allLanguages().map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of FEATURED_LANGUAGES) expect(codes).toContain(code);
    expect(codes.length).toBeGreaterThan(FEATURED_LANGUAGES.length);
    for (const language of allLanguages()) {
      expect(language.code).toMatch(/^[a-z]{2,3}(-[a-z]+)?$|^simple$/);
      expect(language.nativeName.trim()).not.toBe("");
      expect(["ltr", "rtl"]).toContain(language.dir);
    }
    expect(getLanguage("ar").dir).toBe("rtl");
  });

  it("validates untrusted codes and falls back to English", () => {
    expect(isSupportedLanguage("ja")).toBe(true);
    expect(isSupportedLanguage("xx")).toBe(false);
    expect(isSupportedLanguage("evil.example.com/")).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
    expect(resolveLanguage("de")).toBe("de");
    expect(resolveLanguage("../../etc")).toBe(DEFAULT_LANGUAGE);
    expect(getLanguage("nope").code).toBe("en");
    expect(wikipediaDomain("ja")).toBe("ja.wikipedia.org");
    expect(wikipediaDomain("not-a-language")).toBe("en.wikipedia.org");
  });

  it("formats article counts the way the portal does, per locale", () => {
    expect(formatArticleCount(7_254_812, getLanguage("en"))).toBe("7,254,000+ articles");
    expect(formatArticleCount(3_159_340, getLanguage("de"))).toBe("3.159.000+ Artikel");
    expect(formatArticleCount(1_523_999, getLanguage("ja"))).toBe("1,523,000+ 記事");
    // French and Polish group with (narrow) no-break spaces.
    expect(formatArticleCount(2_785_123, getLanguage("fr"))).toMatch(/^2\s785\s000\+ articles$/u);
    expect(formatArticleCount(1_711_400, getLanguage("pl"))).toMatch(/^1\s711\s000\+ haseł$/u);
    expect(formatArticleCount(850, getLanguage("en"))).toBe("850+ articles");
    // Editions without a portal label fall back to English wording.
    expect(formatArticleCount(250_000, getLanguage("ka"))).toMatch(/\+ articles$/);
    expect(languageAbbreviation("ja")).toBe("JA");
  });
});

describe("language-aware paths", () => {
  it("keeps English at /wiki and prefixes other editions", () => {
    expect(articlePath("Halting problem")).toBe("/wiki/Halting_problem");
    expect(articlePath("Halting problem", undefined, "en")).toBe("/wiki/Halting_problem");
    expect(articlePath("停止性問題", undefined, "ja")).toBe(`/ja/wiki/${encodeURIComponent("停止性問題")}`);
    expect(articlePath("Halteproblem", "Beweis", "de")).toBe("/de/wiki/Halteproblem#Beweis");
  });

  it("builds edition-specific Wikipedia and search URLs", () => {
    expect(wikipediaUrl("Halting problem")).toBe("https://en.wikipedia.org/wiki/Halting_problem");
    expect(wikipediaUrl("Halteproblem", "de")).toBe("https://de.wikipedia.org/wiki/Halteproblem");
    expect(searchPath("entropy")).toBe("/search?q=entropy");
    expect(searchPath("エントロピー", "ja")).toBe(`/search?q=${encodeURIComponent("エントロピー")}&lang=ja`);
  });

  it("parses links from the matching edition only", () => {
    expect(titleFromWikiHref("/wiki/Turingmaschine", "de")).toEqual({ title: "Turingmaschine" });
    expect(titleFromWikiHref("https://de.wikipedia.org/wiki/Turingmaschine#Aufbau", "de")).toEqual({
      title: "Turingmaschine",
      fragment: "Aufbau",
    });
    expect(titleFromWikiHref("//de.wikipedia.org/wiki/Turingmaschine", "de")).toEqual({ title: "Turingmaschine" });
    // A link to another edition is not an internal link.
    expect(titleFromWikiHref("https://en.wikipedia.org/wiki/Turing_machine", "de")).toBeNull();
    expect(titleFromWikiHref("https://en.wikipedia.org/wiki/Turing_machine")).toEqual({ title: "Turing machine" });
  });
});

describe("parsing non-English articles", () => {
  const html = `<div class="mw-parser-output">
    <p>Die <b>Turingmaschine</b> ist ein <a href="/wiki/Rechnermodell">Rechnermodell</a> der
    <a href="/wiki/Theoretische_Informatik">theoretischen Informatik</a>, beschrieben von
    <a href="/wiki/Alan_Turing">Alan Turing</a>. Siehe auch <a href="/wiki/Kategorie:Informatik">Kategorie</a>.</p>
    <h2 id="Siehe_auch">Siehe auch</h2>
    <ul><li><a href="/wiki/Halteproblem">Halteproblem</a></li></ul>
    <h2 id="Einzelnachweise">Einzelnachweise</h2>
    <ol class="references"><li id="cite_note-1">Turing, 1936.</li></ol>
  </div>`;

  const doc = parseArticle({ title: "Turingmaschine", displayTitle: "Turingmaschine", pageId: 1, revId: 2, html, categories: [], lang: "de" });

  it("tags the document and its internal links with the edition", () => {
    expect(doc.lang).toBe("de");
    const links = doc.lead.flatMap((b) => (b.k === "p" ? b.c : [])).filter((n) => n.k === "link");
    expect(links.map((l) => (l.k === "link" ? [l.to, l.lang] : null))).toEqual([
      ["Rechnermodell", "de"],
      ["Theoretische Informatik", "de"],
      ["Alan Turing", "de"],
    ]);
  });

  it("recognises localised appendix headings", () => {
    expect(doc.seeAlso).toEqual(["Halteproblem"]);
    expect(doc.sections.find((s) => s.title === "Einzelnachweise")?.kind).toBe("references");
  });

  it("leaves English documents unchanged", () => {
    const en = parseArticle({ title: "X", displayTitle: "X", pageId: 1, revId: 2, html: '<p><a href="/wiki/Y">Y</a> is linked here.</p>', categories: [] });
    expect(en.lang).toBeUndefined();
    const link = en.lead.flatMap((b) => (b.k === "p" ? b.c : [])).find((n) => n.k === "link");
    expect(link && "lang" in link).toBe(false);
  });
});
