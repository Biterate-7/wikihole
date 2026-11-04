import { HTMLElement, NodeType, parse, type Node } from "node-html-parser";
import type { DiffRow, DiffRun } from "./types";

/**
 * Turns the HTML table from MediaWiki's action=compare into WikiHole's diff
 * model, in keeping with the reader: raw Wikipedia HTML never reaches the
 * browser. The diff's content is unchanged; only its markup is replaced.
 */

/** Very large rewrites are cut off here, with a link to the full diff on Wikipedia. */
export const MAX_DIFF_ROWS = 1500;

function pushRun(runs: DiffRun[], text: string, changed: boolean): void {
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && last.changed === changed) last.text += text;
  else runs.push({ text, changed });
}

function collectRuns(node: Node, runs: DiffRun[], changed: boolean): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    pushRun(runs, node.text, changed);
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const tag = node.rawTagName?.toLowerCase();
  const inside = changed || tag === "ins" || tag === "del";
  for (const child of node.childNodes) collectRuns(child, runs, inside);
}

function lineRuns(cell: HTMLElement): DiffRun[] {
  const runs: DiffRun[] = [];
  collectRuns(cell, runs, false);
  return runs;
}

function lineNumber(cell: HTMLElement | undefined): number | null {
  const match = cell?.text.match(/(\d[\d,.\s]*)/);
  if (!match) return null;
  const value = Number(match[1].replace(/\D/g, ""));
  return Number.isFinite(value) ? value : null;
}

export interface ParsedDiff {
  rows: DiffRow[];
  charsAdded: number;
  charsRemoved: number;
  truncated: boolean;
}

/** A line with no marked words is new or deleted as a whole only if the other side is empty. */
function countChanged(runs: DiffRun[] | null, otherSide: DiffRun[] | null): number {
  if (!runs) return 0;
  const marked = runs.filter((r) => r.changed).reduce((n, r) => n + r.text.length, 0);
  if (marked > 0 || otherSide) return marked;
  return runs.reduce((n, r) => n + r.text.length, 0);
}

export function parseCompareBody(body: string): ParsedDiff {
  const root = parse(`<table>${body}</table>`);
  const rows: DiffRow[] = [];
  let charsAdded = 0;
  let charsRemoved = 0;
  let truncated = false;

  for (const tr of root.querySelectorAll("tr")) {
    const numbers = tr.querySelectorAll("td.diff-lineno");
    let row: DiffRow | null = null;
    if (numbers.length > 0) {
      row = { k: "lines", from: lineNumber(numbers[0]), to: lineNumber(numbers[1]) };
    } else {
      const context = tr.querySelector("td.diff-context");
      const removedCell = tr.querySelector("td.diff-deletedline");
      const addedCell = tr.querySelector("td.diff-addedline");
      if (removedCell || addedCell) {
        const removed = removedCell ? lineRuns(removedCell) : null;
        const added = addedCell ? lineRuns(addedCell) : null;
        charsRemoved += countChanged(removed, added);
        charsAdded += countChanged(added, removed);
        row = { k: "change", removed, added };
      } else if (context) {
        row = { k: "context", text: context.text };
      }
    }
    if (!row) continue;
    // Keep counting past the cut-off: the totals describe the whole edit.
    if (rows.length >= MAX_DIFF_ROWS) truncated = true;
    else rows.push(row);
  }
  return { rows, charsAdded, charsRemoved, truncated };
}

/** The diff as plain text with +/- prefixes, for handing to the language model. */
export function diffPlainText(rows: DiffRow[], maxChars = 24000): string {
  const lines: string[] = [];
  const flat = (runs: DiffRun[]) => runs.map((r) => r.text).join("");
  for (const row of rows) {
    if (row.k === "context") lines.push(`  ${row.text}`);
    else if (row.k === "change") {
      if (row.removed) lines.push(`- ${flat(row.removed)}`);
      if (row.added) lines.push(`+ ${flat(row.added)}`);
    }
  }
  const text = lines.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
