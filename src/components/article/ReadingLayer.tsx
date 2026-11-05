"use client";

import { useEffect } from "react";
import { handleAnchorLinks, jumpToAddressedSection } from "./scrollToSection";
import { SelectionLayer } from "./SelectionLayer";
import { TermLayer } from "./TermLayer";

/**
 * The reader's contextual tools, layered over the server-rendered article.
 * They render nothing until the reader acts, so the article's HTML and its
 * hydration are unaffected.
 */
export function ReadingLayer({ title, lang, aiEnabled }: { title: string; lang: string; aiEnabled: boolean }) {
  useEffect(() => {
    const reader = document.querySelector('[data-testid="reader"]');
    if (!reader) return;
    jumpToAddressedSection();
    return handleAnchorLinks(reader);
  }, []);

  return (
    <>
      <TermLayer title={title} lang={lang} aiEnabled={aiEnabled} rootId="article-body" />
      <SelectionLayer title={title} lang={lang} aiEnabled={aiEnabled} rootId="article-body" />
    </>
  );
}
