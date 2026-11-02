/**
 * Grounding checks for AI output: a claim survives only if its evidence quote
 * appears verbatim (modulo whitespace, case and typography) in the article.
 */

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[^\p{L}\p{N}'"\- ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGrounded(evidence: string, normalizedSource: string, minWords = 4): boolean {
  const quote = normalizeForMatch(evidence.replace(/^["'“‘]|["'”’]$/g, "").replace(/…|\.\.\./g, " "));
  if (quote.split(" ").filter(Boolean).length < minWords) return false;
  return normalizedSource.includes(quote);
}
