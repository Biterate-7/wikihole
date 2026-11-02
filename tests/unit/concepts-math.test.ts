import { describe, expect, it } from "vitest";
import { articlePlainText, equations, isNoiseTitle, keyConcepts, terminology } from "@/lib/content/concepts";
import { renderTex, unwrapTex } from "@/lib/content/math";
import { parseArticle } from "@/lib/content/parse";
import { loadParseFixture } from "../support/fixtures";

describe("math rendering", () => {
  it("unwraps Wikipedia's displaystyle wrapper", () => {
    expect(unwrapTex("{\\displaystyle x^{2}+1}")).toBe("x^{2}+1");
    expect(unwrapTex("{\\textstyle a}")).toBe("a");
    expect(unwrapTex("  y ")).toBe("y");
  });

  it("renders TeX with KaTeX and supports texvc macros", () => {
    const { html } = renderTex("\\R \\sub \\N", false);
    expect(html).toContain("katex");
    expect(html).toContain("mathbb");
    expect(html).not.toContain("katex-error");
  });

  it("returns only the TeX source on failure", () => {
    expect(renderTex("\\frac{1}{", true)).toEqual({ tex: "\\frac{1}{" });
  });

  it("does not honour \\href or other trusted commands", () => {
    const { html } = renderTex("\\href{javascript:alert(1)}{x}", false);
    // With trust disabled KaTeX renders the command as inert text, never as a link.
    expect(html ?? "").not.toMatch(/href=/);
  });
});

describe("deterministic concept extraction", () => {
  const doc = parseArticle(loadParseFixture("halting_problem"));

  it("ranks heavily linked concepts and excludes noise titles", () => {
    const concepts = keyConcepts(doc, 10);
    expect(concepts.length).toBe(10);
    expect(concepts.map((c) => c.title)).toEqual(expect.arrayContaining(["Turing machine", "Computable function"]));
    expect(concepts.some((c) => isNoiseTitle(c.title))).toBe(false);
    expect(concepts.some((c) => c.title === doc.title)).toBe(false);
  });

  it("identifies noise titles", () => {
    expect(isNoiseTitle("1936")).toBe(true);
    expect(isNoiseTitle("ISBN (identifier)")).toBe(true);
    expect(isNoiseTitle("Doi (identifier)")).toBe(true);
    expect(isNoiseTitle("Turing machine")).toBe(false);
  });

  it("quotes terminology in its original sentence", () => {
    for (const name of ["kolmogorov_complexity", "enigma_machine"]) {
      const article = parseArticle(loadParseFixture(name));
      const terms = terminology(article, 12);
      expect(terms.length, name).toBeGreaterThan(0);
      for (const t of terms) {
        expect(t.context).toContain(t.term);
        expect(t.term.toLowerCase()).not.toBe(article.title.toLowerCase());
        expect(t.term).not.toMatch(/^[\d\s.,]+$/);
      }
    }
    expect(terminology(doc, 12).every((t) => t.term.toLowerCase() !== "halting problem")).toBe(true);
  });

  it("lists display equations with their sections", () => {
    const eqs = equations(doc);
    expect(eqs.length).toBeGreaterThan(0);
    expect(eqs.every((e) => e.sectionId)).toBe(true);
  });

  it("produces plain text grounded in the article for AI prompts", () => {
    const text = articlePlainText(doc, 60000);
    expect(text).toContain("Alan Turing proved in 1937 that the halting problem is undecidable");
    expect(text).toContain("## History");
    // "<" does occur legitimately inside TeX (e.g. "j<n"), so look for real markup only.
    expect(text).not.toMatch(/<\/?(p|div|span|a|b|i|sup|table|td|style|script|math)[\s>]/i);
    expect(articlePlainText(doc, 100).length).toBe(100);
  });
});
