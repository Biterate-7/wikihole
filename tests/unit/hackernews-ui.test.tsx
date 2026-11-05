// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeGraph } from "@/components/exploration/KnowledgeGraph";
import { ExplorationTools } from "@/components/exploration/ExplorationTools";
import { SubmissionExplorer } from "@/components/exploration/SubmissionExplorer";
import { HackerNewsFeed } from "@/components/hackernews/HackerNewsFeed";
import { SubmissionCard } from "@/components/hackernews/SubmissionCard";
import type { Exploration, ExplorationPreview, HoleEdge, HoleNode } from "@/lib/discovery/hole-types";
import type { HackerNewsFeed as Feed } from "@/lib/hackernews/service";
import { submission } from "../support/hn";

afterEach(() => cleanup());

const sub = submission({ id: 123, title: "Raft: how consensus works", domain: "raft.github.io", url: "https://raft.github.io/" });

const preview: ExplorationPreview = {
  submission: sub,
  primary: { title: "Raft (algorithm)", description: "Consensus algorithm", lead: "Raft is a consensus algorithm designed as an alternative to Paxos." },
  tags: ["Paxos (computer science)", "Leader election"],
  disciplines: [{ id: "systems", label: "Systems & distributed computing" }],
  articleCount: 18,
  quality: 81.5,
  score: { total: 72.4, components: { technical: 1, novelty: 0.5, relevance: 1, entities: 0.6, coverage: 0.8, connections: 0.7, engagement: 0.5 }, signals: [] },
  builtAt: 0,
};

const feed = (overrides: Partial<Feed> = {}): Feed => ({
  items: [preview],
  category: "all",
  offset: 0,
  nextOffset: null,
  total: 1,
  pending: 0,
  processing: [],
  insufficient: 2,
  rejected: 9,
  lastIngest: 0,
  warning: null,
  ...overrides,
});

const n = (id: string, level: 0 | 1 | 2 | 3 | 4, parent: string | undefined, title: string, extra: Partial<HoleNode> = {}): HoleNode => ({
  id,
  title,
  level,
  kind: level === 0 ? "submission" : "concept",
  role: level === 0 ? "submission" : level === 1 ? "direct" : "prerequisite",
  relevance: 0.6,
  extract: level ? `${title} is an important idea.` : undefined,
  ...(parent ? { parent } : {}),
  ...extra,
});

const nodes: HoleNode[] = [
  n("root", 0, undefined, sub.title),
  n("p1", 1, "root", "Raft (algorithm)", { role: "primary", confidence: 0.91, mentionedAs: ["Raft"], description: "Consensus algorithm" }),
  n("p2", 2, "p1", "Consensus (computer science)"),
  n("p3", 2, "p1", "Leader election", { role: "direct" }),
  n("p4", 3, "p1", "Paxos (computer science)", { role: "historical" }),
  n("p5", 4, "p4", "Byzantine fault", { role: "adjacent" }),
];
const edge = (source: string, target: string, kind: HoleEdge["kind"], explanation: string, structural = true): HoleEdge => ({ id: `${source}>${target}`, source, target, kind, label: kind, explanation, evidence: "lead", structural });
const edges: HoleEdge[] = [
  edge("root", "p1", "direct", "Named in the submission title as “Raft”."),
  edge("p1", "p2", "prerequisite", "“Raft (algorithm)” is defined in terms of “Consensus (computer science)” in the opening sentence of its article."),
  edge("p1", "p3", "direct", "“Leader election” is linked from the introduction of “Raft (algorithm)”."),
  edge("p1", "p4", "historical", "“Paxos (computer science)” is linked in the “History” section of “Raft (algorithm)”."),
  edge("p4", "p5", "adjacent", "“Byzantine fault” is listed under See also in “Paxos (computer science)”."),
  edge("p3", "p2", "direct", "“Leader election” links to “Consensus (computer science)” on Wikipedia.", false),
];

const exploration: Exploration = {
  version: 1,
  submission: sub,
  builtAt: 0,
  summary: { primary: preview.primary, secondary: [], prerequisites: ["Consensus (computer science)"], historical: ["Paxos (computer science)"], descendants: [], adjacent: ["Byzantine fault"], disciplines: preview.disciplines },
  nodes,
  edges,
  entities: [
    { entity: "Raft", source: "title", status: "resolved", title: "Raft (algorithm)", confidence: 0.91, method: "search", reasons: [] },
    { entity: "florbnitz", source: "text", status: "unresolved", reason: "no-article", reasons: [] },
  ],
  quality: { score: 81.5, status: "complete", components: { coverage: 0.8, confidence: 0.9, depth: 1, connectivity: 0.6, articles: 0.7, technical: 0.9 }, notes: [] },
  score: preview.score,
  metrics: { resolvedEntities: 1, obscurity: 0.4, relevance: 1 },
};

describe("SubmissionCard", () => {
  it("shows what can be learned and keeps the source one click away", () => {
    render(<SubmissionCard item={preview} rank={1} />);
    const card = screen.getByTestId("hn-item");
    expect(within(card).getByRole("link", { name: "Raft: how consensus works" }).getAttribute("href")).toBe("/hackernews/123");
    expect(card.textContent).toContain("About Raft (algorithm), consensus algorithm.");
    expect(card.textContent).toContain("18 Wikipedia articles");
    expect(within(card).getByRole("link", { name: "Leader election" }).getAttribute("href")).toBe("/wiki/Leader_election");
    expect(within(card).getByRole("link", { name: /Discussion on Hacker News/ }).getAttribute("href")).toBe("https://news.ycombinator.com/item?id=123");
    expect(within(card).getByRole("link", { name: /Original article on raft.github.io/ }).getAttribute("href")).toBe("https://raft.github.io/");
  });
});

describe("submissions that link to Wikipedia", () => {
  const wikipedia = submission({ id: 124, title: "Antikythera mechanism", url: "https://en.wikipedia.org/wiki/Antikythera_mechanism", domain: "en.wikipedia.org" });

  it("open in the reader on the card, with no outbound Wikipedia link", () => {
    const { container } = render(<SubmissionCard item={{ ...preview, submission: wikipedia }} rank={1} />);
    expect(container.querySelectorAll('a[href*="wikipedia.org"]')).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Antikythera mechanism in WikiHole" }).getAttribute("href")).toBe("/wiki/Antikythera_mechanism");
  });

  it("have no outbound Wikipedia link in the exploration view or tools", () => {
    const hole = { ...exploration, submission: wikipedia };
    const { container } = render(
      <>
        <SubmissionExplorer exploration={hole} status="complete" />
        <ExplorationTools exploration={hole} />
      </>,
    );
    expect(container.querySelectorAll('a[href*="wikipedia.org"]')).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Antikythera mechanism in WikiHole" }).length).toBe(2);
  });
});

describe("HackerNewsFeed", () => {
  it("renders the feed with counts", () => {
    render(<HackerNewsFeed initial={feed()} category="all" />);
    expect(screen.getAllByTestId("hn-item")).toHaveLength(1);
    expect(screen.getByText(/1 rabbit hole · 2 too thin to show · 9 filtered out/i)).toBeTruthy();
  });

  it("shows a loading state", () => {
    render(<HackerNewsFeed initial={null} pending category="all" />);
    expect(screen.getByTestId("hn-feed").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText(/Reading Hacker News/)).toBeTruthy();
  });

  it("distinguishes 'still building' from a genuinely empty list", () => {
    render(<HackerNewsFeed initial={feed({ items: [], total: 0, pending: 12, processing: [{ id: 9, title: "Something being analysed" }] })} category="all" />);
    expect(screen.getByText("The first rabbit holes are still being dug.")).toBeTruthy();
    expect(screen.getByText("Something being analysed")).toBeTruthy();
    cleanup();
    render(<HackerNewsFeed initial={feed({ items: [], total: 0, pending: 0 })} category="ask" />);
    expect(screen.getByText("No submissions in this list produced a rabbit hole.")).toBeTruthy();
  });

  it("recovers from an error and switches lists", async () => {
    const fetchMock = vi.fn(async (input: string) => Response.json(feed({ category: (new URL(input, "http://t").searchParams.get("category") ?? "all") as Feed["category"] })));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<HackerNewsFeed initial={null} initialError="Hacker News is unavailable right now." category="all" />);
    expect(screen.getByRole("alert").textContent).toContain("Hacker News is unavailable right now.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByTestId("hn-item")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Show HN" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("category=show"));
    expect(screen.getByRole("button", { name: "Show HN" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("KnowledgeGraph", () => {
  it("renders visible nodes and selects them by click and keyboard", () => {
    const onSelect = vi.fn();
    render(<KnowledgeGraph nodes={nodes} edges={edges} depth={2} selected={null} onSelect={onSelect} />);
    const graph = screen.getByTestId("knowledge-graph");
    expect(within(graph).getAllByTestId("graph-node")).toHaveLength(4);
    fireEvent.click(within(graph).getByRole("button", { name: /Leader election/ }));
    expect(onSelect).toHaveBeenCalledWith("p3");
    fireEvent.keyDown(within(graph).getByRole("button", { name: /Consensus/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("p2");
    expect(screen.getByRole("list", { name: "Relation types" }).textContent).toMatch(/Prerequisite.*Historical/);
  });
});

describe("SubmissionExplorer", () => {
  it("shows the source, the primary article, the graph and explained relations", async () => {
    const user = userEvent.setup();
    render(<SubmissionExplorer exploration={exploration} status="complete" />);
    const source = screen.getByTestId("hn-source");
    expect(within(source).getByRole("link", { name: /Discussion on Hacker News/ }).getAttribute("href")).toBe("https://news.ycombinator.com/item?id=123");
    expect(within(source).getByRole("link", { name: /Original article/ }).getAttribute("href")).toBe("https://raft.github.io/");
    const primary = screen.getByTestId("primary-article");
    expect(within(primary).getByRole("link", { name: /Read in WikiHole/ }).getAttribute("href")).toBe("/wiki/Raft_(algorithm)");
    expect(screen.getByTestId("hole-summary").textContent).toContain("The submission is mainly about Raft (algorithm), consensus algorithm.");

    // Depth 2 by default; deeper levels appear when the depth increases.
    expect(screen.getAllByTestId("hole-article").map((a) => a.dataset.title).sort()).toEqual(["Consensus (computer science)", "Leader election"]);
    await user.click(within(screen.getByRole("group", { name: "Exploration depth" })).getByRole("button", { name: "4" }));
    expect(screen.getAllByTestId("hole-article")).toHaveLength(4);
    expect(screen.getByText(/listed under See also in “Paxos \(computer science\)”/)).toBeTruthy();

    // Selecting a node shows its sourced relations.
    fireEvent.click(within(screen.getByTestId("knowledge-graph")).getByRole("button", { name: /Paxos/ }));
    expect(screen.getByTestId("graph-detail").textContent).toContain("“History” section");
  });

  it("lists what was extracted, the quality score and sources in the tools column", () => {
    render(<ExplorationTools exploration={exploration} />);
    const entities = screen.getByTestId("hole-entities");
    expect(entities.textContent).toContain("Raft");
    expect(within(entities).getByRole("link", { name: "Raft (algorithm)" }).getAttribute("href")).toBe("/wiki/Raft_(algorithm)");
    expect(entities.textContent).toContain("no matching article");
    expect(screen.getByRole("heading", { name: /Rabbit hole quality: 82/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Submission on Hacker News" }).getAttribute("href")).toBe("https://news.ycombinator.com/item?id=123");
  });

  it("links articles into the reader, never out to Wikipedia, and keeps the attribution", async () => {
    const user = userEvent.setup();
    const { container } = render(<SubmissionExplorer exploration={exploration} status="complete" />);
    await user.click(within(screen.getByRole("group", { name: "Exploration depth" })).getByRole("button", { name: "4" }));
    expect(container.querySelectorAll('a[href*="wikipedia.org"]')).toHaveLength(0);
    expect(screen.getByText("From Wikipedia: Raft (algorithm)")).toBeTruthy();
  });

  it("labels insufficient holes", () => {
    render(<SubmissionExplorer exploration={{ ...exploration, quality: { ...exploration.quality, status: "insufficient", notes: ["Only 5 Wikipedia articles could be connected."] } }} status="insufficient" />);
    expect(screen.getByRole("status").textContent).toContain("Only 5 Wikipedia articles could be connected.");
  });
});
