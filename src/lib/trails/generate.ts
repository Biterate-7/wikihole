import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getClient } from "@/lib/ai/client";
import { getAiConfig } from "@/lib/ai/config";
import { TtlCache } from "@/lib/cache";
import { articlePlainText, rankLinks } from "@/lib/content/concepts";
import type { ArticleDocument } from "@/lib/content/types";
import type { PageMeta } from "@/lib/wikipedia/types";
import { isValidTitle, normalizeTitle } from "@/lib/wikipedia/titles";
import { linkingSentence } from "./evidence";
import { MAX_STOPS, MIN_STOPS, titleKey, trailProblems } from "./graph";
import type { TrailDefinition } from "./types";

/**
 * Trails from any article, for articles no curated trail passes through.
 *
 * The model proposes trails; nothing it writes is shown until it passes the
 * same kind of checks the reader's AI analysis uses:
 *   - every title is a real English Wikipedia article (not a disambiguation page),
 *   - no article appears twice,
 *   - each article links to the next one in its running text, and the sentence
 *     containing that link is quoted from Wikipedia as the step's evidence.
 * A trail with any step that fails is dropped whole: a trail is only as
 * trustworthy as its weakest step.
 */

const ProposalSchema = z.object({
  trails: z.array(
    z.object({
      steps: z.array(z.object({ title: z.string(), summary: z.string(), detail: z.string() })),
      payoff: z.string(),
    }),
  ),
});
export type TrailProposal = z.infer<typeof ProposalSchema>["trails"][number];

export class TrailGenerationError extends Error {
  constructor(
    message: string,
    readonly code: "disabled" | "refused" | "failed",
  ) {
    super(message);
  }
}

const SYSTEM_PROMPT = `You design "unexpected connection" trails for WikiHole, a site for curious readers of Wikipedia.
A trail starts at a given article and moves, one linked article at a time, to a destination that is surprising given the start yet fully defensible.
You will receive the start article's text and the articles it links to.

Rules:
- Each step moves to an English Wikipedia article that the previous article links to in its running text. The first step must be copied exactly from the supplied list of linked articles.
- Use exact English Wikipedia article titles. Never a disambiguation page, list or category.
- Each trail has 3 or 4 steps after the start. No article may appear twice in a trail.
- Every step must be a real, well-documented relationship that the Wikipedia articles themselves state. Do not invent or stretch historical, scientific or causal relationships. If you are not sure a step is true and linked, choose a different one.
- Avoid obvious steps to very general articles (countries, centuries, broad fields). Each step should make the next one possible.
- "summary": one sentence of at most 18 words saying why the previous article leads to this one.
- "detail": one or two sentences of at most 50 words with the specific facts behind the step.
- "payoff": one sentence, stated as a fact about the destination, on why it is a surprising place to arrive.
- Return up to 3 trails with different destinations. Write plainly and concretely. No hype.`;

const MAX_SUMMARY = 200;
const MAX_DETAIL = 480;
const MAX_TRAILS = 3;

export interface VerifyDeps {
  /** Metadata keyed by normalised requested title; null when Wikipedia has no such article. */
  metas(titles: string[]): Promise<Map<string, PageMeta | null>>;
  /** The parsed article, or null if it cannot be loaded. */
  doc(title: string): Promise<ArticleDocument | null>;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Keeps only the proposals whose every step checks out against Wikipedia. */
export async function verifyProposals(
  start: ArticleDocument,
  proposals: TrailProposal[],
  deps: VerifyDeps,
): Promise<{ trails: TrailDefinition[]; rejected: number }> {
  const requested = proposals.map((p) => p.steps.map((s) => normalizeTitle(s.title)));
  const all = [...new Set(requested.flat().filter(isValidTitle))];
  const metas = all.length ? await deps.metas(all) : new Map<string, PageMeta | null>();
  const docs = new Map<string, Promise<ArticleDocument | null>>([[titleKey(start.title), Promise.resolve(start)]]);
  const docOf = (title: string) => {
    const key = titleKey(title);
    if (!docs.has(key)) docs.set(key, deps.doc(title).catch(() => null));
    return docs.get(key)!;
  };

  const trails: TrailDefinition[] = [];
  const seen = new Set<string>();
  let rejected = 0;

  for (const [index, proposal] of proposals.entries()) {
    const titles = requested[index];
    const trail = await verifyOne(start, proposal, titles, metas, docOf, index);
    const key = trail?.titles.map(titleKey).join("|");
    if (!trail || !key || seen.has(key) || trails.length >= MAX_TRAILS) {
      rejected++;
      continue;
    }
    seen.add(key);
    trails.push(trail);
  }
  return { trails, rejected };
}

async function verifyOne(
  start: ArticleDocument,
  proposal: TrailProposal,
  requested: string[],
  metas: Map<string, PageMeta | null>,
  docOf: (title: string) => Promise<ArticleDocument | null>,
  index: number,
): Promise<TrailDefinition | null> {
  if (requested.length + 1 < MIN_STOPS || requested.length + 1 > MAX_STOPS) return null;
  if (!requested.every(isValidTitle)) return null;

  const canonical: string[] = [];
  const pageIds = new Set([start.pageId]);
  for (const title of requested) {
    const meta = metas.get(title);
    if (!meta || meta.disambiguation || pageIds.has(meta.pageId)) return null;
    pageIds.add(meta.pageId);
    canonical.push(meta.title);
  }

  const titles = [start.title, ...canonical];
  const connections: TrailDefinition["connections"] = [];
  for (const [i, step] of proposal.steps.entries()) {
    const summary = clean(step.summary);
    const detail = clean(step.detail);
    if (!summary || !detail || summary.length > MAX_SUMMARY || detail.length > MAX_DETAIL) return null;
    const from = await docOf(titles[i]);
    if (!from) return null;
    const quote = linkingSentence(from, [requested[i], canonical[i]]);
    if (!quote) return null;
    connections.push({ summary, detail, evidence: { quote, source: titles[i] } });
  }

  const trail: TrailDefinition = {
    id: `generated-${start.pageId}-${index + 1}`,
    origin: "generated",
    titles,
    connections,
    payoff: clean(proposal.payoff),
  };
  return trailProblems(trail).length === 0 ? trail : null;
}

const cache = new TtlCache<{ trails: TrailDefinition[]; rejected: number }>(300, 24 * 60 * 60 * 1000);

/** Proposes trails from `start` with the configured model and returns the ones that verify. */
export async function generateTrails(start: ArticleDocument, deps: VerifyDeps): Promise<{ trails: TrailDefinition[]; rejected: number }> {
  const config = getAiConfig();
  if (!config) throw new TrailGenerationError("AI generation is not configured", "disabled");

  return cache.getOrLoad(`${start.pageId}|${start.revId}|${config.model}`, async () => {
    const source = articlePlainText(start, 14000);
    const linked = rankLinks(start.links)
      .filter((l) => titleKey(l.title) !== titleKey(start.title))
      .slice(0, 150)
      .map((l) => l.title);

    const response = await getClient(config.apiKey).beta.messages.parse({
      model: config.model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(ProposalSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `<article title="${start.title.replace(/"/g, "'")}">\n${source}\n</article>\n\n<linked_articles>\n${linked.join("\n")}\n</linked_articles>`,
        },
      ],
    });

    if (response.stop_reason === "refusal") throw new TrailGenerationError("The model declined to build a trail from this article", "refused");
    if (!response.parsed_output) throw new TrailGenerationError("The model returned an unusable response", "failed");
    return verifyProposals(start, response.parsed_output.trails, deps);
  });
}
