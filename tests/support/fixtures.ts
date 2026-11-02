import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParseInput } from "@/lib/content/parse";

interface ParseFixture {
  parse: {
    title: string;
    pageid: number;
    revid: number;
    displaytitle: string;
    text: string;
    categories: Array<{ category: string; hidden?: boolean }>;
  };
}

export function loadParseFixture(name: string): ParseInput {
  const raw = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", `parse-${name}.json`), "utf8")) as ParseFixture;
  return {
    title: raw.parse.title,
    displayTitle: raw.parse.title,
    pageId: raw.parse.pageid,
    revId: raw.parse.revid,
    html: raw.parse.text,
    categories: raw.parse.categories.filter((c) => !c.hidden).map((c) => c.category.replace(/_/g, " ")),
  };
}

export function loadJsonFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, "..", "fixtures", name), "utf8")) as T;
}
