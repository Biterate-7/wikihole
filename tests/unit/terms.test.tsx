// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { markTerms } from "@/components/article/termMarks";
import { selectTerms, termScore, type ReaderTerm } from "@/lib/content/terms";
import type { ArticleDocument, LinkStat } from "@/lib/content/types";
import type { PageMeta } from "@/lib/wikipedia/types";

function meta(title: string, extra: Partial<PageMeta> = {}): PageMeta {
  return { pageId: 1, title, length: 5000, disambiguation: false, recentViews: 1000, categories: [], ...extra };
}

describe("termScore", () => {
  it("accepts specialised subjects", () => {
    expect(termScore(meta("Rotor machine", { description: "Class of electromechanical encryption devices" }), true)).toBeGreaterThan(0);
    expect(termScore(meta("Cipher", { description: "Algorithm for encrypting and decrypting information" }), true)).toBeGreaterThan(0);
    expect(termScore(meta("Peace of Westphalia", { description: "Treaty ending the Thirty Years War" }), true)).toBeGreaterThan(0);
  });

  it("leaves out places, people, disambiguation pages and household names", () => {
    expect(termScore(meta("Poland", { description: "Country in Central Europe" }), true)).toBeNull();
    expect(termScore(meta("Alan Turing", { description: "English mathematician (1912–1954)" }), true)).toBeNull();
    expect(termScore(meta("Mercury", { disambiguation: true }), true)).toBeNull();
    expect(termScore(meta("Computer", { description: "Programmable machine", recentViews: 900_000 }), true)).toBeNull();
    expect(termScore(meta("Marian Rejewski", { description: "Theory person", categories: ["1905 births"] }), true)).toBeNull();
  });

  it("does not apply English word lists to other editions", () => {
    expect(termScore(meta("Algorithmus", { description: "Country", categories: ["Algorithm"] }), false)).not.toBeNull();
  });
});

function doc(links: LinkStat[], words = 2000): ArticleDocument {
  return {
    title: "Enigma machine",
    displayTitle: "Enigma machine",
    pageId: 1,
    revId: 1,
    lead: [{ k: "p", c: [{ k: "text", v: "The " }, { k: "strong", c: [{ k: "text", v: "Enigma machine" }] }, { k: "text", v: " is a device that uses a " }, { k: "strong", c: [{ k: "text", v: "reflector wheel" }] }, { k: "text", v: " inside it." }] }],
    sections: [],
    references: [],
    infobox: [],
    categories: [],
    links,
    seeAlso: [],
    stats: { words, equations: 0, tables: 0, figures: 0, references: 0 },
  };
}

const link = (title: string, order: number): LinkStat => ({ title, count: 1, inLead: false, firstSection: 1, order });

describe("selectTerms", () => {
  it("offers terms with Wikipedia's own description and link, and only ever from the article", () => {
    const metas = new Map<string, PageMeta | null>([
      ["Cipher", meta("Cipher", { description: "Algorithm for encrypting", extract: "A cipher is an algorithm." })],
      ["Poland", meta("Poland", { description: "Country in Central Europe" })],
      ["Missing page", null],
    ]);
    const terms = selectTerms(doc([link("Cipher", 0), link("Poland", 1), link("Missing page", 2)]), metas);
    expect(terms.find((t) => t.match === "Cipher")).toMatchObject({ kind: "link", link: "Cipher", description: "Algorithm for encrypting", extract: "A cipher is an algorithm." });
    expect(terms.map((t) => t.match)).not.toContain("Poland");
    expect(terms.map((t) => t.match)).not.toContain("Missing page");
  });

  it("includes terms the article defines in bold, but not its own title", () => {
    const terms = selectTerms(doc([]), new Map());
    expect(terms.map((t) => t.match)).toEqual(["reflector wheel"]);
    expect(terms[0].kind).toBe("defined");
  });

  it("does not mark the article's own title even through a redirect", () => {
    const metas = new Map([["Enigma cipher", meta("Enigma machine", { description: "Algorithm" })]]);
    expect(selectTerms(doc([link("Enigma cipher", 0)]), metas).filter((t) => t.kind === "link")).toEqual([]);
  });

  it("scales with the article and stays capped", () => {
    const links = Array.from({ length: 40 }, (_, i) => link(`Theory ${i}`, i));
    const metas = new Map(links.map((l) => [l.title, meta(l.title, { description: "Mathematical theory" })]));
    const count = (words: number) => selectTerms(doc(links, words), metas).filter((t) => t.kind === "link").length;
    expect(count(100)).toBe(5);
    expect(count(2500)).toBe(10);
    expect(count(100000)).toBe(24);
  });
});

describe("markTerms", () => {
  const terms: ReaderTerm[] = [
    { match: "Cipher", kind: "link", link: "Cipher" },
    { match: "Plaintext", kind: "link", link: "Plaintext" },
    { match: "reflector wheel", kind: "defined" },
  ];

  function article(html: string) {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  }
  const a = (title: string, text = title.toLowerCase()) => `<a data-title="${title}" href="/wiki/${title}">${text}</a>`;
  const marked = (root: Element) => [...root.querySelectorAll("[data-term]")].map((el) => el.getAttribute("data-term"));

  it("marks only the first use of a term", () => {
    const root = article(`<p>A ${a("Cipher")}.</p><p>Another ${a("Cipher")}.</p>`);
    markTerms(root, terms);
    expect(root.querySelectorAll("[data-term]")).toHaveLength(1);
    expect(root.querySelector("p")?.querySelector("[data-term]")).not.toBeNull();
  });

  it("marks at most one term per paragraph, falling through to a later use", () => {
    const root = article(`<p>${a("Cipher")} and ${a("Plaintext")}.</p><p>More ${a("Plaintext")}.</p>`);
    markTerms(root, terms);
    expect(marked(root)).toEqual(["Cipher", "Plaintext"]);
    expect(root.querySelectorAll("p")[0].querySelectorAll("[data-term]")).toHaveLength(1);
    expect(root.querySelectorAll("p")[1].querySelectorAll("[data-term]")).toHaveLength(1);
  });

  it("stays out of tables, captions, references and notes", () => {
    const root = article(`
      <table><tr><td><p>${a("Cipher")}</p></td></tr></table>
      <figure><figcaption><p>${a("Cipher")}</p></figcaption></figure>
      <p data-no-terms>${a("Cipher")}</p>
      <section data-no-terms><p>${a("Cipher")}</p></section>
      <details><p>${a("Cipher")}</p></details>`);
    markTerms(root, terms);
    expect(marked(root)).toEqual([]);
  });

  it("changes attributes only, leaving text and structure as they were", () => {
    const html = `<p>A ${a("Cipher")} is here.</p>`;
    const root = article(html);
    const textNode = root.querySelector("a")?.firstChild;
    markTerms(root, terms);
    expect(root.textContent).toBe("A cipher is here.");
    expect(root.querySelector("a")?.firstChild).toBe(textNode);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("/wiki/Cipher");
  });

  it("makes bold definitions keyboard reachable, and italic definitions too", () => {
    const root = article(`<p>Has a <strong>reflector wheel</strong>.</p>`);
    markTerms(root, terms);
    const strong = root.querySelector("strong");
    expect(strong?.getAttribute("role")).toBe("button");
    expect(strong?.getAttribute("tabindex")).toBe("0");

    const italic = article(`<p>called the <em>reflector wheel</em>.</p>`);
    markTerms(italic, terms);
    expect(marked(italic)).toEqual(["reflector wheel"]);
  });

  it("skips link text too long to be a term", () => {
    const root = article(`<p>${a("Cipher", "x".repeat(121))}</p>`);
    markTerms(root, terms);
    expect(marked(root)).toEqual([]);
  });

  it("is safe to run again as sections stream in", () => {
    const root = article(`<p>${a("Cipher")}</p>`);
    markTerms(root, terms);
    root.insertAdjacentHTML("beforeend", `<p>${a("Cipher")} and ${a("Plaintext")}</p>`);
    markTerms(root, terms);
    expect(marked(root)).toEqual(["Cipher", "Plaintext"]);
  });
});
