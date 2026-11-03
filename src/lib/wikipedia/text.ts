/**
 * TextExtracts' plain-text mode keeps MathML alt text such as
 * "{\displaystyle \|}" next to the rendered symbol. Strip those annotations
 * (balanced braces) and tidy the whitespace they leave behind.
 */
export function cleanExtract(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let text = raw;
  for (let start = text.indexOf("{\\displaystyle"); start >= 0; start = text.indexOf("{\\displaystyle")) {
    let depth = 0;
    let end = start;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    text = text.slice(0, start) + text.slice(end + 1);
  }
  const cleaned = text
    // Pronunciation markup leaves empty brackets behind: "Git () is…", "Kafka (; born…)".
    .replace(/\s*\(\s*[;,]?\s*\)/g, "")
    .replace(/\(\s*[;,]\s*/g, "(")
    .replace(/[ \t]+/g, " ")
    .replace(/ ([,.;:)])/g, "$1")
    .replace(/\( /g, "(")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return cleaned || undefined;
}
