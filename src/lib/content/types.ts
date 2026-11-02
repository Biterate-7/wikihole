/**
 * WikiHole's structured article model. Wikipedia HTML is parsed server-side
 * into this allow-listed tree and rendered with React components; raw
 * Wikipedia HTML never reaches the browser.
 */

export type Inline =
  | { k: "text"; v: string }
  | { k: "em" | "strong" | "sub" | "sup" | "code" | "small" | "s"; c: Inline[] }
  /** Link to another Wikipedia article, rendered as a WikiHole reader link. */
  | { k: "link"; to: string; fragment?: string; c: Inline[] }
  /** In-page anchor (e.g. a Harvard-style short citation). */
  | { k: "anchor"; target: string; c: Inline[] }
  /** External http(s) link, or a Wikipedia page we do not render (Help:, File:…). */
  | { k: "ext"; href: string; c: Inline[] }
  /** Math rendered by KaTeX from the article's TeX source. `html` is absent if KaTeX failed. */
  | { k: "math"; tex: string; html?: string }
  | { k: "cite"; target: string; label: string }
  | { k: "target"; id: string; c: Inline[] }
  | { k: "br" };

export interface WikiImage {
  src: string;
  srcSet?: string;
  width: number;
  height: number;
  alt: string;
}

export interface ListItem {
  c: Inline[];
  sub: Block[];
}

export interface TableCell {
  header: boolean;
  colSpan?: number;
  rowSpan?: number;
  c: Inline[];
}

export type Block =
  | { k: "p"; c: Inline[] }
  | { k: "h"; level: 3 | 4 | 5; id: string; text: string }
  | { k: "list"; ordered: boolean; items: ListItem[] }
  | { k: "dl"; items: Array<{ term?: Inline[]; defs: Inline[][] }> }
  | { k: "math"; tex: string; html?: string }
  | { k: "figure"; img: WikiImage; caption: Inline[] }
  | { k: "gallery"; items: Array<{ img: WikiImage; caption: Inline[] }> }
  | { k: "table"; caption?: Inline[]; rows: TableCell[][]; columns: number; truncated: boolean }
  | { k: "quote"; c: Block[] }
  | { k: "code"; text: string }
  | { k: "note"; c: Inline[] }
  /** A references/footnotes list, rendered where it appeared in the article. */
  | { k: "refs"; items: Reference[] };

export type SectionKind = "content" | "see-also" | "references" | "external" | "further";

export interface Heading {
  id: string;
  text: string;
  level: 2 | 3 | 4 | 5;
}

export interface Section {
  id: string;
  title: string;
  kind: SectionKind;
  blocks: Block[];
  /** Sub-headings (h3+) inside this section, for the table of contents. */
  headings: Heading[];
}

export interface Reference {
  id: string;
  label: string;
  c: Inline[];
}

export interface InfoboxRow {
  label: string;
  value: Inline[];
}

export interface LinkStat {
  title: string;
  count: number;
  inLead: boolean;
  /** Index of the section where the link first appears (-1 = lead). */
  firstSection: number;
  /** Title of that section (absent for the lead). */
  sectionTitle?: string;
  order: number;
}

export interface Term {
  term: string;
  /** The sentence from the article in which the term is introduced. */
  context: string;
  sectionId?: string;
}

export interface Equation {
  tex: string;
  html?: string;
  sectionId?: string;
  sectionTitle?: string;
}

export interface ArticleDocument {
  title: string;
  displayTitle: string;
  pageId: number;
  revId: number;
  lead: Block[];
  sections: Section[];
  references: Reference[];
  infobox: InfoboxRow[];
  infoboxImage?: WikiImage;
  categories: string[];
  links: LinkStat[];
  seeAlso: string[];
  stats: { words: number; equations: number; tables: number; figures: number; references: number };
}
