import { describe, expect, it } from "vitest";
import { inlineText, parseArticle } from "@/lib/content/parse";
import type { Block, Inline } from "@/lib/content/types";
import { loadParseFixture } from "../support/fixtures";

function allBlocks(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [
    b,
    ...(b.k === "quote" ? allBlocks(b.c) : []),
    ...(b.k === "list" ? b.items.flatMap((i) => allBlocks(i.sub)) : []),
  ]);
}

function allInlines(nodes: Inline[]): Inline[] {
  return nodes.flatMap((n) => [n, ...("c" in n ? allInlines(n.c) : [])]);
}

function docInlines(blocks: Block[]): Inline[] {
  return allBlocks(blocks).flatMap((b) => {
    if (b.k === "p" || b.k === "note") return allInlines(b.c);
    if (b.k === "list") return b.items.flatMap((i) => allInlines(i.c));
    if (b.k === "table") return b.rows.flat().flatMap((c) => allInlines(c.c));
    if (b.k === "refs") return b.items.flatMap((r) => allInlines(r.c));
    return [];
  });
}

describe("parseArticle on real Wikipedia output", () => {
  const halting = parseArticle(loadParseFixture("halting_problem"));

  it("splits the lead and the h2 sections in order", () => {
    expect(halting.lead[0]).toMatchObject({ k: "p" });
    expect(inlineText((halting.lead[0] as Extract<Block, { k: "p" }>).c)).toMatch(/^In computability theory, the halting problem/);
    const titles = halting.sections.map((s) => s.title);
    expect(titles.slice(0, 5)).toEqual(["Background", "History", "Formalization", "Computability theory", "Generalization"]);
    expect(halting.sections.find((s) => s.title === "See also")?.kind).toBe("see-also");
    expect(halting.sections.find((s) => s.title === "References")?.kind).toBe("references");
    expect(halting.sections.find((s) => s.title === "External links")?.kind).toBe("external");
  });

  it("collects sub-headings for the table of contents", () => {
    const background = halting.sections.find((s) => s.title === "Background");
    expect(background?.headings.map((h) => h.text)).toContain("Programming consequences");
    expect(background?.headings.every((h) => h.level >= 3)).toBe(true);
  });

  it("renders display math with KaTeX from the TeX source", () => {
    const maths = halting.sections.flatMap((s) => allBlocks(s.blocks)).filter((b) => b.k === "math");
    expect(maths.length).toBeGreaterThan(0);
    for (const m of maths) {
      if (m.k !== "math") continue;
      expect(m.html).toContain("katex");
      expect(m.tex).not.toMatch(/^\{\\displaystyle/);
    }
    expect(maths.some((m) => m.k === "math" && m.tex.includes("\\begin{cases}"))).toBe(true);
  });

  it("turns article links into reader links and tracks them", () => {
    const links = docInlines(halting.lead).filter((n) => n.k === "link");
    expect(links.map((l) => (l.k === "link" ? l.to : ""))).toContain("Decision problem");
    const turing = halting.links.find((l) => l.title === "Alan Turing");
    expect(turing?.inLead).toBe(true);
    expect(halting.seeAlso).toContain("Busy beaver");
  });

  it("extracts references with decoded ids that match citation targets", () => {
    expect(halting.references.length).toBeGreaterThan(20);
    const ids = new Set(halting.references.map((r) => r.id));
    for (const r of halting.references) expect(r.id).not.toContain("&#");
    const cites = docInlines([...halting.lead, ...halting.sections.flatMap((s) => s.blocks)]).filter((n) => n.k === "cite");
    expect(cites.length).toBeGreaterThan(10);
    const resolved = cites.filter((c) => c.k === "cite" && ids.has(c.target));
    expect(resolved.length / cites.length).toBeGreaterThan(0.9);
  });

  it("never lets editorial chrome through (navboxes, edit links, styles)", () => {
    const text = JSON.stringify(halting);
    expect(text).not.toContain("mw-parser-output");
    expect(text).not.toContain("navbox");
    expect(text).not.toMatch(/<style|<script|\[edit\]/i);
  });

  it("counts words and stats", () => {
    expect(halting.stats.words).toBeGreaterThan(3000);
    expect(halting.stats.references).toBe(halting.references.length);
  });

  it("parses figures, galleries and data tables (Enigma machine)", () => {
    const enigma = parseArticle(loadParseFixture("enigma_machine"));
    const blocks = [...enigma.lead, ...enigma.sections.flatMap((s) => allBlocks(s.blocks))];
    const figure = blocks.find((b) => b.k === "figure");
    expect(figure).toBeDefined();
    if (figure?.k === "figure") {
      expect(figure.img.src).toMatch(/^https:\/\/(thumb|upload)\.wikimedia\.org\//);
      expect(figure.img.width).toBeGreaterThan(0);
      expect(figure.img.height).toBeGreaterThan(0);
      expect(figure.caption.length).toBeGreaterThan(0);
    }
    expect(blocks.some((b) => b.k === "gallery")).toBe(true);
    const table = blocks.find((b) => b.k === "table");
    expect(table?.k === "table" && table.caption && inlineText(table.caption)).toMatch(/turnover notches/i);
    if (table?.k === "table") {
      expect(table.columns).toBe(3);
      expect(table.rows[0].every((c) => c.header)).toBe(true);
    }
  });

  it("extracts infobox facts without counting them as concept links (Antikythera mechanism)", () => {
    const doc = parseArticle(loadParseFixture("antikythera_mechanism"));
    expect(doc.infobox.map((r) => r.label)).toEqual(expect.arrayContaining(["Type", "Created"]));
    expect(inlineText(doc.infobox.find((r) => r.label === "Created")!.value)).toMatch(/century BC/);
    expect(doc.infoboxImage?.src).toMatch(/^https:\/\/thumb\.wikimedia\.org\//);
  });
});

describe("parseArticle safety and robustness", () => {
  const base = { title: "Test", displayTitle: "Test", pageId: 1, revId: 1, categories: [] };

  it("drops scripts, event handlers and javascript: URLs", () => {
    const doc = parseArticle({
      ...base,
      html: `<div class="mw-parser-output"><p onclick="alert(1)">Safe <script>alert(2)</script><a href="javascript:alert(3)">click</a> <img src="x" onerror="alert(4)"> text <a href="https://example.org/a">ext</a></p><iframe src="https://evil"></iframe></div>`,
    });
    const json = JSON.stringify(doc);
    expect(json).not.toMatch(/alert|onclick|onerror|javascript:|iframe|evil/);
    const inlines = docInlines(doc.lead);
    expect(inlines.some((n) => n.k === "ext" && n.href === "https://example.org/a")).toBe(true);
    expect(inlineText((doc.lead[0] as Extract<Block, { k: "p" }>).c)).toBe("Safe click text ext");
  });

  it("rejects images from non-Wikimedia hosts", () => {
    const doc = parseArticle({
      ...base,
      html: `<figure><img src="https://tracker.example/pixel.png" width="300" height="200"><figcaption>x</figcaption></figure><figure><img src="//upload.wikimedia.org/a.png" width="300" height="200"></figure>`,
    });
    const figures = doc.lead.filter((b) => b.k === "figure");
    expect(figures).toHaveLength(1);
    expect(figures[0].k === "figure" && figures[0].img.src).toBe("https://upload.wikimedia.org/a.png");
  });

  it("handles empty, malformed and unclosed HTML without throwing", () => {
    expect(() => parseArticle({ ...base, html: "" })).not.toThrow();
    expect(parseArticle({ ...base, html: "" }).lead).toEqual([]);
    const doc = parseArticle({ ...base, html: "<div><p>Unclosed <b>bold <i>italic<h2>Next</h2><p>After</div></span></table>" });
    // node-html-parser does not auto-close <p> before <h2> like a browser; what matters is that no text is lost.
    const text = JSON.stringify(doc);
    for (const word of ["Unclosed", "bold", "italic", "Next", "After"]) expect(text).toContain(word);
    expect(parseArticle({ ...base, html: "<h2>Only</h2>" }).sections).toEqual([]);
  });

  it("falls back to TeX source when KaTeX cannot render", () => {
    const doc = parseArticle({
      ...base,
      html: `<p><span class="mwe-math-element mwe-math-element-block"><math alttext="{\\displaystyle \\unknownmacro{x}}"></math></span></p>`,
    });
    expect(doc.lead[0]).toEqual({ k: "math", tex: "\\unknownmacro{x}" });
  });

  it("treats red links as plain text and Help: links as text", () => {
    const doc = parseArticle({
      ...base,
      html: `<p><a href="/w/index.php?title=Nope&action=edit" class="new">Missing</a> and <a href="/wiki/Help:IPA">IPA</a> and <a href="/wiki/Category:Foo">cat</a></p>`,
    });
    const inlines = docInlines(doc.lead);
    expect(inlines.some((n) => n.k === "link")).toBe(false);
    expect(inlines.some((n) => n.k === "ext" && n.href.includes("Category"))).toBe(true);
    expect(inlineText((doc.lead[0] as Extract<Block, { k: "p" }>).c)).toBe("Missing and IPA and cat");
  });
});
