import { parse, HTMLElement, TextNode, type Node } from "node-html-parser";
import { isArticleNamespace, titleFromWikiHref, wikipediaUrl } from "@/lib/wikipedia/titles";
import { renderTex } from "./math";
import { normalizeMediaUrl } from "./media";
import type {
  ArticleDocument,
  Block,
  Heading,
  InfoboxRow,
  Inline,
  LinkStat,
  ListItem,
  Reference,
  Section,
  SectionKind,
  TableCell,
  WikiImage,
} from "./types";

/**
 * Transforms MediaWiki parser output into WikiHole's allow-listed article
 * model. Anything not explicitly understood is either unwrapped to its text or
 * dropped; no attribute, style or script from the source survives.
 */

const SKIP_TAGS = new Set([
  "style",
  "script",
  "link",
  "meta",
  "noscript",
  "template",
  "input",
  "button",
  "map",
  "area",
  "audio",
  "video",
  "source",
  "track",
  "iframe",
  "object",
  "embed",
  "svg",
  "img",
  "hr",
  "wbr",
]);

const SKIP_CLASSES = new Set([
  "navbox",
  "navbox-styles",
  "vertical-navbox",
  "sidebar",
  "metadata",
  "ambox",
  "ombox",
  "tmbox",
  "cmbox",
  "fmbox",
  "imbox",
  "mbox-small",
  "noprint",
  "mw-editsection",
  "shortdescription",
  "sistersitebox",
  "side-box",
  "portalbox",
  "portal",
  "portal-bar",
  "mw-empty-elt",
  "toc",
  "authority-control",
  "catlinks",
  "printfooter",
  "mw-cite-backlink",
  "Z3988",
  "mwe-math-fallback-image-inline",
  "mwe-math-fallback-image-display",
  "mw-kartographer-maplink",
  "haudio",
  "mediaContainer",
  "stub",
  "asbox",
  "succession-box",
  "ext-phonos",
]);

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "ul",
  "ol",
  "dl",
  "table",
  "figure",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "center",
  "section",
]);

const REFERENCE_SECTION =
  /^(references|notes|footnotes|citations|sources|bibliography|works cited|notes and references|references and notes|explanatory notes|general references|cited sources|primary sources|secondary sources|literature|cited works|notes and citations|citations and notes|general and cited references)$/i;

function sectionKind(title: string): SectionKind {
  const t = title.trim();
  if (/^see also$/i.test(t)) return "see-also";
  if (/^external links?$/i.test(t)) return "external";
  if (/^further reading$/i.test(t)) return "further";
  if (REFERENCE_SECTION.test(t)) return "references";
  return "content";
}

const MAX_TABLE_ROWS = 150;
const MAX_INFOBOX_ROWS = 16;

type Flat = Block | { k: "h2"; id: string; text: string };

function tagOf(el: HTMLElement): string {
  return (el.rawTagName ?? "").toLowerCase();
}

function classesOf(el: HTMLElement): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

function hasSkipClass(classes: string[]): boolean {
  return classes.some((c) => SKIP_CLASSES.has(c) || c.startsWith("box-"));
}

function elementChildren(el: HTMLElement): HTMLElement[] {
  return el.childNodes.filter((n): n is HTMLElement => n instanceof HTMLElement);
}

function int(value: string | undefined, fallback: number, max = 10000): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** Merges adjacent text runs and collapses whitespace (no trimming). */
function collapse(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    if (node.k === "text") {
      const v = node.v.replace(/\s+/g, " ");
      if (!v) continue;
      const last = out[out.length - 1];
      if (last?.k === "text") last.v = (last.v + v).replace(/\s+/g, " ");
      else out.push({ k: "text", v });
    } else if ("c" in node && node.k !== "target" && node.c.length === 0) {
      continue;
    } else if (node.k === "br" && out[out.length - 1]?.k === "br") {
      continue;
    } else {
      out.push(node);
    }
  }
  return out;
}

/** Collapses whitespace and trims leading/trailing whitespace and breaks. */
function tidy(nodes: Inline[]): Inline[] {
  const out = collapse(nodes);
  const isBlank = (n: Inline | undefined) => !!n && (n.k === "br" || (n.k === "text" && !n.v.trim()));
  while (isBlank(out[0])) out.shift();
  while (isBlank(out[out.length - 1])) out.pop();
  const first = out[0];
  if (first?.k === "text") out[0] = { k: "text", v: first.v.trimStart() };
  const last = out[out.length - 1];
  if (last?.k === "text") out[out.length - 1] = { k: "text", v: last.v.trimEnd() };
  return out;
}

export function inlineText(nodes: Inline[]): string {
  let s = "";
  for (const n of nodes) {
    if (n.k === "text") s += n.v;
    else if (n.k === "math") s += n.tex;
    else if (n.k === "br") s += " ";
    else if (n.k === "cite") continue;
    else s += inlineText(n.c);
  }
  return s;
}

function isMathOnly(nodes: Inline[]): boolean {
  let math = 0;
  for (const n of nodes) {
    if (n.k === "math") math++;
    else if (n.k === "text" && /^[\s,.;:()]*$/.test(n.v)) continue;
    else if (n.k === "br") continue;
    else return false;
  }
  return math > 0;
}

function texOf(el: HTMLElement): string | null {
  const math = tagOf(el) === "math" ? el : el.querySelector("math");
  const alt = math?.getAttribute("alttext");
  if (alt?.trim()) return alt;
  const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation?.text.trim()) return annotation.text;
  const img = el.querySelector("img");
  return img?.getAttribute("alt")?.trim() || null;
}

class ArticleBuilder {
  private readonly links = new Map<string, LinkStat>();
  private linkOrder = 0;
  private sectionIndex = -1;
  private currentKind: SectionKind = "content";
  private currentTitle?: string;
  private trackLinks = true;
  readonly references: Reference[] = [];
  readonly citeLabels = new Map<string, string>();
  readonly seeAlso: string[] = [];
  infobox: InfoboxRow[] = [];
  infoboxImage?: WikiImage;

  get linkStats(): LinkStat[] {
    return [...this.links.values()];
  }

  private trackLink(title: string): void {
    if (!this.trackLinks) return;
    if (this.currentKind === "see-also" && !this.seeAlso.includes(title)) this.seeAlso.push(title);
    if (this.currentKind !== "content") return;
    const existing = this.links.get(title);
    if (existing) {
      existing.count++;
      if (this.sectionIndex < 0) existing.inLead = true;
    } else {
      this.links.set(title, {
        title,
        count: 1,
        inLead: this.sectionIndex < 0,
        firstSection: this.sectionIndex,
        ...(this.currentTitle ? { sectionTitle: this.currentTitle } : {}),
        order: this.linkOrder++,
      });
    }
  }

  private withoutTracking<T>(run: () => T): T {
    const previous = this.trackLinks;
    this.trackLinks = false;
    try {
      return run();
    } finally {
      this.trackLinks = previous;
    }
  }

  /* ----------------------------- inline ----------------------------- */

  inline(nodes: Node[]): Inline[] {
    const out: Inline[] = [];
    for (const node of nodes) out.push(...this.inlineNode(node));
    return collapse(out);
  }

  private wrap(k: "em" | "strong" | "sub" | "sup" | "code" | "small" | "s", el: HTMLElement): Inline[] {
    const c = this.inline(el.childNodes);
    return c.length ? [{ k, c }] : [];
  }

  private inlineNode(node: Node): Inline[] {
    if (node instanceof TextNode) {
      const v = node.text;
      return v ? [{ k: "text", v }] : [];
    }
    if (!(node instanceof HTMLElement)) return [];
    const tag = tagOf(node);
    if (!tag) return this.inline(node.childNodes);
    if (SKIP_TAGS.has(tag)) return [];
    const classes = classesOf(node);
    if (hasSkipClass(classes)) return [];
    if (classes.includes("mwe-math-element") || tag === "math") {
      const tex = texOf(node);
      return tex ? [{ k: "math", ...renderTex(tex, false) }] : [];
    }

    switch (tag) {
      case "a":
        return this.anchor(node);
      case "b":
      case "strong":
        return this.wrap("strong", node);
      case "i":
      case "em":
      case "var":
      case "dfn":
        return this.wrap("em", node);
      case "sub":
        return this.wrap("sub", node);
      case "sup":
        return classes.includes("reference") ? this.cite(node) : this.wrap("sup", node);
      case "code":
      case "kbd":
      case "samp":
      case "tt": {
        const v = node.text;
        return v.trim() ? [{ k: "code", c: [{ k: "text", v }] }] : [];
      }
      case "small":
        return this.wrap("small", node);
      case "s":
      case "del":
      case "strike":
        return this.wrap("s", node);
      case "br":
        return [{ k: "br" }];
      case "q":
        return [{ k: "text", v: "“" }, ...this.inline(node.childNodes), { k: "text", v: "”" }];
      case "cite": {
        const c = this.inline(node.childNodes);
        const id = node.getAttribute("id");
        return id ? [{ k: "target", id, c }] : c;
      }
      case "span": {
        const id = node.getAttribute("id");
        if (id && classes.includes("anchor")) return [{ k: "target", id, c: [] }];
        return this.inline(node.childNodes);
      }
      case "table":
      case "figure":
        return [];
      case "li":
      case "p":
      case "div":
      case "dd":
      case "dt":
      case "tr":
        return [...this.inline(node.childNodes), { k: "br" }];
      case "ul":
      case "ol":
      case "dl":
      case "tbody":
        return this.inline(node.childNodes);
      case "td":
      case "th":
        return [...this.inline(node.childNodes), { k: "text", v: " " }];
      default:
        return this.inline(node.childNodes);
    }
  }

  private anchor(el: HTMLElement): Inline[] {
    const href = el.getAttribute("href") ?? "";
    const c = this.inline(el.childNodes);
    if (c.length === 0) return [];
    if (classesOf(el).includes("new")) return c; // red link: page does not exist
    const wiki = titleFromWikiHref(href);
    if (wiki) {
      if (/^help:/i.test(wiki.title)) return c;
      if (!isArticleNamespace(wiki.title)) return [{ k: "ext", href: wikipediaUrl(wiki.title), c }];
      this.trackLink(wiki.title);
      return [{ k: "link", to: wiki.title, ...(wiki.fragment ? { fragment: wiki.fragment } : {}), c }];
    }
    if (href.startsWith("#")) {
      const target = href.slice(1);
      return target ? [{ k: "anchor", target, c }] : c;
    }
    const absolute = href.startsWith("//") ? `https:${href}` : href;
    if (/^https?:\/\//i.test(absolute)) {
      try {
        return [{ k: "ext", href: new URL(absolute).toString(), c }];
      } catch {
        return c;
      }
    }
    return c;
  }

  private cite(sup: HTMLElement): Inline[] {
    const a = sup.querySelector("a");
    const href = a?.getAttribute("href") ?? "";
    if (!a || !href.startsWith("#")) return [];
    const target = href.slice(1);
    const label = a.text.replace(/[[\]]/g, "").trim();
    if (!label) return [];
    if (!this.citeLabels.has(target)) this.citeLabels.set(target, label);
    return [{ k: "cite", target, label }];
  }

  /* ----------------------------- blocks ----------------------------- */

  blocks(nodes: Node[]): Flat[] {
    const out: Flat[] = [];
    let pending: Inline[] = [];
    const flush = () => {
      const c = tidy(pending);
      pending = [];
      if (c.length === 0) return;
      if (isMathOnly(c)) {
        for (const n of c) if (n.k === "math") out.push({ ...renderTex(n.tex, true), k: "math" });
      } else {
        out.push({ k: "p", c });
      }
    };
    for (const node of nodes) {
      if (node instanceof TextNode) {
        pending.push(...this.inlineNode(node));
        continue;
      }
      if (!(node instanceof HTMLElement)) continue;
      const tag = tagOf(node);
      const classes = classesOf(node);
      if (SKIP_TAGS.has(tag) || hasSkipClass(classes)) continue;
      const blockMath = classes.includes("mwe-math-element-block");
      if (BLOCK_TAGS.has(tag) || blockMath) {
        flush();
        this.block(node, tag, classes, out);
      } else {
        pending.push(...this.inlineNode(node));
      }
    }
    flush();
    return out;
  }

  private contentBlocks(nodes: Node[]): Block[] {
    return this.blocks(nodes).filter((b): b is Block => b.k !== "h2");
  }

  private heading(el: HTMLElement, out: Flat[]): void {
    const level = Number(tagOf(el).slice(1));
    const text = el.text.replace(/\s+/g, " ").trim();
    if (!text) return;
    const id = el.getAttribute("id") || text.replace(/\s+/g, "_");
    if (level <= 2) {
      this.sectionIndex++;
      this.currentKind = sectionKind(text);
      this.currentTitle = text;
      out.push({ k: "h2", id, text });
    } else {
      out.push({ k: "h", level: Math.min(level, 5) as 3 | 4 | 5, id, text });
    }
  }

  private block(el: HTMLElement, tag: string, classes: string[], out: Flat[]): void {
    if (classes.includes("mwe-math-element")) {
      const tex = texOf(el);
      if (tex) out.push({ k: "math", ...renderTex(tex, true) });
      return;
    }
    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        this.heading(el, out);
        return;
      case "p": {
        out.push(...this.blocks(el.childNodes));
        return;
      }
      case "div":
        this.div(el, classes, out);
        return;
      case "ul":
        if (classes.includes("gallery")) this.gallery(el, out);
        else this.list(el, false, out);
        return;
      case "ol":
        if (classes.includes("references")) this.referenceList(el, out);
        else this.list(el, true, out);
        return;
      case "dl":
        this.definitionList(el, out);
        return;
      case "table":
        this.table(el, classes, out);
        return;
      case "figure":
        this.figure(el, out);
        return;
      case "blockquote": {
        const c = this.contentBlocks(el.childNodes);
        if (c.length) out.push({ k: "quote", c });
        return;
      }
      case "pre": {
        const text = el.text.replace(/^\n+|\s+$/g, "");
        if (text) out.push({ k: "code", text });
        return;
      }
      default:
        out.push(...this.blocks(el.childNodes));
    }
  }

  private div(el: HTMLElement, classes: string[], out: Flat[]): void {
    if (classes.includes("mw-heading")) {
      const h = elementChildren(el).find((c) => /^h[1-6]$/.test(tagOf(c)));
      if (h) this.heading(h, out);
      return;
    }
    if (classes.includes("hatnote")) {
      const c = this.withoutTracking(() => tidy(this.inline(el.childNodes)));
      if (c.length) out.push({ k: "note", c });
      return;
    }
    if (classes.includes("tmulti")) {
      this.multiImage(el, out);
      return;
    }
    if (classes.includes("thumb")) {
      this.legacyThumb(el, out);
      return;
    }
    if (classes.includes("mw-highlight")) {
      const text = el.text.replace(/^\n+|\s+$/g, "");
      if (text) out.push({ k: "code", text });
      return;
    }
    if (classes.includes("quotebox")) {
      const c = this.contentBlocks(el.childNodes);
      if (c.length) out.push({ k: "quote", c });
      return;
    }
    if (classes.includes("infobox")) return;
    out.push(...this.blocks(el.childNodes));
  }

  private list(el: HTMLElement, ordered: boolean, out: Flat[]): void {
    const items: ListItem[] = [];
    for (const li of elementChildren(el)) {
      if (tagOf(li) !== "li" || hasSkipClass(classesOf(li))) continue;
      const inlineNodes: Node[] = [];
      const sub: Block[] = [];
      for (const child of li.childNodes) {
        if (child instanceof HTMLElement && ["ul", "ol", "dl", "table", "figure"].includes(tagOf(child))) {
          sub.push(...this.contentBlocks([child]));
        } else {
          inlineNodes.push(child);
        }
      }
      const c = tidy(this.inline(inlineNodes));
      if (c.length || sub.length) items.push({ c, sub });
    }
    if (items.length) out.push({ k: "list", ordered, items });
  }

  private definitionList(el: HTMLElement, out: Flat[]): void {
    const children = elementChildren(el);
    const items: Array<{ term?: Inline[]; defs: Inline[][] }> = [];
    let current: { term?: Inline[]; defs: Inline[][] } | undefined;
    for (const child of children) {
      const tag = tagOf(child);
      if (tag === "dt") {
        current = { term: tidy(this.inline(child.childNodes)), defs: [] };
        items.push(current);
      } else if (tag === "dd") {
        // A dd holding only math is how wikitext writes display equations (":<math>").
        const nestedBlocks = elementChildren(child).some((c) =>
          ["dl", "ul", "ol", "table", "figure", "div"].includes(tagOf(c)),
        );
        if (nestedBlocks && !current) {
          out.push(...this.blocks(child.childNodes));
          continue;
        }
        const c = tidy(this.inline(child.childNodes));
        if (c.length === 0) continue;
        if (isMathOnly(c) && !current) {
          for (const n of c) if (n.k === "math") out.push({ ...renderTex(n.tex, true), k: "math" });
          continue;
        }
        if (!current) {
          current = { defs: [] };
          items.push(current);
        }
        current.defs.push(c);
      }
    }
    const meaningful = items.filter((i) => (i.term && i.term.length) || i.defs.length);
    if (meaningful.length) out.push({ k: "dl", items: meaningful });
  }

  private image(img: HTMLElement | null): WikiImage | null {
    if (!img) return null;
    const src = normalizeMediaUrl(img.getAttribute("src"));
    if (!src) return null;
    const width = int(img.getAttribute("width"), 0);
    const height = int(img.getAttribute("height"), 0);
    if (!width || !height || (width < 60 && height < 60)) return null;
    const srcSet = (img.getAttribute("srcset") ?? "")
      .split(",")
      .map((candidate) => {
        const [url, descriptor] = candidate.trim().split(/\s+/, 2);
        const normalized = normalizeMediaUrl(url);
        return normalized && descriptor && /^\d+(\.\d+)?[wx]$/.test(descriptor) ? `${normalized} ${descriptor}` : null;
      })
      .filter(Boolean)
      .join(", ");
    return { src, width, height, alt: img.getAttribute("alt")?.trim() ?? "", ...(srcSet ? { srcSet } : {}) };
  }

  private figure(el: HTMLElement, out: Flat[]): void {
    const img = this.image(el.querySelector("img"));
    if (!img) return;
    const caption = el.querySelector("figcaption");
    out.push({ k: "figure", img, caption: caption ? tidy(this.inline(caption.childNodes)) : [] });
  }

  private legacyThumb(el: HTMLElement, out: Flat[]): void {
    const img = this.image(el.querySelector("img"));
    if (!img) return;
    const caption = el.querySelector(".thumbcaption");
    out.push({ k: "figure", img, caption: caption ? tidy(this.inline(caption.childNodes)) : [] });
  }

  private multiImage(el: HTMLElement, out: Flat[]): void {
    const items: Array<{ img: WikiImage; caption: Inline[] }> = [];
    for (const single of el.querySelectorAll(".tsingle")) {
      const img = this.image(single.querySelector("img"));
      if (!img) continue;
      const caption = single.querySelector(".thumbcaption");
      items.push({ img, caption: caption ? tidy(this.inline(caption.childNodes)) : [] });
    }
    const overall = elementChildren(el.querySelector(".thumbinner, .multiimageinner") ?? el).find((c) =>
      classesOf(c).includes("thumbcaption"),
    );
    if (overall && items.length) {
      const caption = tidy(this.inline(overall.childNodes));
      if (caption.length) items[items.length - 1].caption = [...items[items.length - 1].caption, { k: "br" }, ...caption];
    }
    if (items.length === 1) out.push({ k: "figure", ...items[0] });
    else if (items.length > 1) out.push({ k: "gallery", items });
  }

  private gallery(el: HTMLElement, out: Flat[]): void {
    const items: Array<{ img: WikiImage; caption: Inline[] }> = [];
    for (const box of el.querySelectorAll("li.gallerybox")) {
      const img = this.image(box.querySelector("img"));
      if (!img) continue;
      const caption = box.querySelector(".gallerytext");
      items.push({ img, caption: caption ? tidy(this.inline(caption.childNodes)) : [] });
    }
    if (items.length) out.push({ k: "gallery", items });
  }

  private rowsOf(table: HTMLElement): HTMLElement[] {
    const rows: HTMLElement[] = [];
    for (const child of elementChildren(table)) {
      const tag = tagOf(child);
      if (tag === "tr") rows.push(child);
      else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
        for (const row of elementChildren(child)) if (tagOf(row) === "tr") rows.push(row);
      }
    }
    return rows;
  }

  private table(el: HTMLElement, classes: string[], out: Flat[]): void {
    if (classes.includes("infobox")) {
      if (this.infobox.length === 0 && !this.infoboxImage) this.extractInfobox(el);
      return;
    }
    const rows = this.rowsOf(el);
    const isData = classes.includes("wikitable") || classes.includes("sortable");
    const cells = rows.flatMap((r) => elementChildren(r).filter((c) => ["td", "th"].includes(tagOf(c))));
    const hasHeader = cells.some((c) => tagOf(c) === "th");
    const hasBlockContent = cells.some((c) => c.querySelector("figure, p, ul, ol, div, table, img") !== null);
    const isLayout = el.getAttribute("role") === "presentation" || (!isData && (!hasHeader || hasBlockContent));
    if (isLayout) {
      for (const cell of cells) out.push(...this.blocks(cell.childNodes));
      return;
    }

    let columns = 0;
    const parsedRows: TableCell[][] = [];
    for (const row of rows.slice(0, MAX_TABLE_ROWS)) {
      const parsedCells: TableCell[] = [];
      let width = 0;
      for (const cell of elementChildren(row)) {
        const tag = tagOf(cell);
        if (tag !== "td" && tag !== "th") continue;
        const colSpan = int(cell.getAttribute("colspan"), 1, 50);
        const rowSpan = int(cell.getAttribute("rowspan"), 1, 200);
        width += colSpan;
        parsedCells.push({
          header: tag === "th",
          ...(colSpan > 1 ? { colSpan } : {}),
          ...(rowSpan > 1 ? { rowSpan } : {}),
          c: tidy(this.inline(cell.childNodes)),
        });
      }
      columns = Math.max(columns, width);
      if (parsedCells.length) parsedRows.push(parsedCells);
    }
    if (parsedRows.length === 0) return;
    const captionEl = elementChildren(el).find((c) => tagOf(c) === "caption");
    const caption = captionEl ? tidy(this.inline(captionEl.childNodes)) : undefined;
    out.push({
      k: "table",
      ...(caption && caption.length ? { caption } : {}),
      rows: parsedRows,
      columns,
      truncated: rows.length > MAX_TABLE_ROWS,
    });
  }

  private extractInfobox(table: HTMLElement): void {
    this.withoutTracking(() => {
      for (const row of this.rowsOf(table)) {
        const cells = elementChildren(row);
        const imageCell = cells.find((c) => classesOf(c).includes("infobox-image"));
        if (imageCell && !this.infoboxImage) {
          this.infoboxImage = this.image(imageCell.querySelector("img")) ?? undefined;
          continue;
        }
        const label = cells.find((c) => tagOf(c) === "th" && classesOf(c).includes("infobox-label"));
        const data = cells.find((c) => tagOf(c) === "td" && classesOf(c).includes("infobox-data"));
        if (!label || !data || this.infobox.length >= MAX_INFOBOX_ROWS) continue;
        const labelText = label.text.replace(/\s+/g, " ").trim();
        const value = tidy(this.inline(data.childNodes));
        if (labelText && value.length) this.infobox.push({ label: labelText, value });
      }
    });
  }

  private referenceList(el: HTMLElement, out: Flat[]): void {
    const items: Reference[] = [];
    this.withoutTracking(() => {
      elementChildren(el).forEach((li, index) => {
        if (tagOf(li) !== "li") return;
        const textEl = li.querySelector(".reference-text") ?? li;
        const c = tidy(this.inline(textEl.childNodes));
        if (!c.length) return;
        items.push({ id: li.getAttribute("id") || `ref-${index + 1}`, label: String(index + 1), c });
      });
    });
    if (items.length) {
      this.references.push(...items);
      out.push({ k: "refs", items });
    }
  }
}

function countWords(blocks: Block[]): number {
  let words = 0;
  const count = (text: string) => {
    const m = text.match(/\S+/g);
    words += m ? m.length : 0;
  };
  for (const b of blocks) {
    if (b.k === "p" || b.k === "note") count(inlineText(b.c));
    else if (b.k === "list") for (const item of b.items) {
      count(inlineText(item.c));
      words += countWords(item.sub);
    }
    else if (b.k === "dl") for (const item of b.items) {
      if (item.term) count(inlineText(item.term));
      for (const d of item.defs) count(inlineText(d));
    }
    else if (b.k === "quote") words += countWords(b.c);
  }
  return words;
}

export interface ParseInput {
  title: string;
  displayTitle: string;
  pageId: number;
  revId: number;
  html: string;
  categories: string[];
}

function rootOf(html: string): HTMLElement {
  const root = parse(html, { comment: false, blockTextElements: {} });
  return root.querySelector(".mw-parser-output") ?? root;
}

/** Parses a full article (or a single section) into an ArticleDocument. */
export function parseArticle(input: ParseInput): ArticleDocument {
  const builder = new ArticleBuilder();
  const flat = builder.blocks(rootOf(input.html).childNodes);

  const lead: Block[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const block of flat) {
    if (block.k === "h2") {
      current = { id: block.id, title: block.text, kind: sectionKind(block.text), blocks: [], headings: [] };
      sections.push(current);
      continue;
    }
    if (block.k === "h" && current) {
      current.headings.push({ id: block.id, text: block.text, level: block.level } satisfies Heading);
    }
    (current ? current.blocks : lead).push(block);
  }

  // Resolve footnote labels to the labels used at the citation sites.
  for (const ref of builder.references) {
    const label = builder.citeLabels.get(ref.id);
    if (label) ref.label = label;
  }

  const nonEmpty = sections.filter((s) => s.blocks.length > 0);
  const content = [lead, ...nonEmpty.filter((s) => s.kind === "content").map((s) => s.blocks)];
  const all = [lead, ...nonEmpty.map((s) => s.blocks)].flat();
  const walk = (blocks: Block[], pred: (b: Block) => boolean): number =>
    blocks.reduce(
      (n, b) =>
        n +
        (pred(b) ? 1 : 0) +
        (b.k === "quote" ? walk(b.c, pred) : 0) +
        (b.k === "list" ? b.items.reduce((m, i) => m + walk(i.sub, pred), 0) : 0),
      0,
    );

  return {
    title: input.title,
    displayTitle: input.displayTitle,
    pageId: input.pageId,
    revId: input.revId,
    lead,
    sections: nonEmpty,
    references: builder.references,
    infobox: builder.infobox,
    ...(builder.infoboxImage ? { infoboxImage: builder.infoboxImage } : {}),
    categories: input.categories,
    links: builder.linkStats,
    seeAlso: builder.seeAlso,
    stats: {
      words: content.reduce((n, blocks) => n + countWords(blocks), 0),
      equations: walk(all, (b) => b.k === "math"),
      tables: walk(all, (b) => b.k === "table"),
      figures: walk(all, (b) => b.k === "figure") + all.filter((b) => b.k === "gallery").length,
      references: builder.references.length,
    },
  };
}
