// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneratedTrails } from "@/components/trails/GeneratedTrails";
import { TrailExplorer } from "@/components/trails/TrailExplorer";
import { TrailView } from "@/components/trails/TrailView";
import { CURATED_TRAILS } from "@/lib/trails/curated";
import { curatedTrail, curatedTrailsFeaturedFirst } from "@/lib/trails/graph";
import { resolveTrail } from "@/lib/trails/resolve";
import type { ResolvedTrail } from "@/lib/trails/types";
import type { PageMeta } from "@/lib/wikipedia/types";

const meta = (title: string, overrides: Partial<PageMeta> = {}): PageMeta => ({
  pageId: title.length,
  title,
  length: 1,
  disambiguation: false,
  recentViews: null,
  categories: [],
  ...overrides,
});

/** A curated trail as the server resolves it, with every article found and no thumbnails. */
function resolved(id: string, canStart: (t: string) => boolean = () => true, extra: Record<string, Partial<PageMeta> | null> = {}): ResolvedTrail {
  const trail = curatedTrail(id)!;
  const metas = new Map<string, PageMeta | null>(
    trail.titles.map((t) => [t, extra[t] === null ? null : meta(t, { description: `About ${t}`, ...(extra[t] ?? {}) })]),
  );
  return resolveTrail(trail, metas, canStart);
}

const all = () => curatedTrailsFeaturedFirst().map((t) => resolved(t.id));
const cards = () => screen.getAllByTestId("trail-card");
const route = () => screen.getByTestId("trail-route").textContent?.replace(/\s+/g, " ");

afterEach(() => {
  cleanup();
});

describe("TrailView", () => {
  it("renders the whole trail: positions, titles, descriptions, connections and the payoff", () => {
    render(<TrailView trail={resolved("moon-landing-to-arpanet")} />);
    expect(cards()).toHaveLength(5);
    expect(cards().map((c) => within(c).getByRole("heading").textContent)).toEqual(["Apollo 11", "Space Race", "Sputnik crisis", "DARPA", "ARPANET"]);
    expect(within(cards()[0]).getByText("Start")).toBeTruthy();
    expect(within(cards()[2]).getByText("Step 3 of 5")).toBeTruthy();
    expect(within(cards()[4]).getByText("Destination")).toBeTruthy();
    expect(within(cards()[1]).getByText("About Space Race")).toBeTruthy();

    const connections = screen.getAllByTestId("trail-connection");
    expect(connections).toHaveLength(4);
    expect(connections[0].textContent).toContain("The Moon landing was the culmination of the Space Race.");
    expect(screen.getByTestId("trail-payoff").textContent).toContain("1969");
    expect(within(cards()[4]).getByTestId("trail-payoff")).toBeTruthy();
  });

  it("links every card to the WikiHole reader and offers new trails from later articles", () => {
    render(<TrailView trail={resolved("moon-landing-to-arpanet")} />);
    expect(screen.getByRole("link", { name: "Space Race" }).getAttribute("href")).toBe("/wiki/Space_Race");
    expect(screen.getByRole("link", { name: "Apollo 11" }).getAttribute("href")).toBe("/wiki/Apollo_11");
    const starts = screen.getAllByRole("link", { name: /^Start a trail from / });
    // Not from the first card: the trail already starts there.
    expect(starts.map((a) => a.getAttribute("href"))).toEqual([
      "/connections?from=Space_Race",
      "/connections?from=Sputnik_crisis",
      "/connections?from=DARPA",
      "/connections?from=ARPANET",
    ]);
    for (const a of screen.getAllByRole("link")) expect(a.getAttribute("href")).not.toMatch(/wikipedia\.org/);
  });

  it("offers “Start a trail here” only where a trail can start", () => {
    render(<TrailView trail={resolved("loom-to-lord-byron", (t) => t === "Analytical engine")} />);
    const starts = screen.getAllByRole("link", { name: /^Start a trail from / });
    expect(starts.map((a) => a.getAttribute("aria-label"))).toEqual(["Start a trail from Analytical engine"]);
  });

  it("handles missing thumbnails, missing descriptions and articles Wikipedia no longer has", () => {
    const trail = resolved("coffee-to-lloyds", () => true, {
      Coffee: { thumbnail: { src: "https://upload.wikimedia.org/coffee.jpg", width: 48, height: 48 } },
      Coffeehouse: { description: undefined },
      "Lloyd's Coffee House": null,
    });
    render(<TrailView trail={trail} />);
    const [coffee, house, lloyds, market] = cards();
    expect(coffee.querySelector("img")?.getAttribute("src")).toBe("https://upload.wikimedia.org/coffee.jpg");
    // No image: a placeholder initial keeps the card aligned.
    expect(house.querySelector("img")).toBeNull();
    expect(house.textContent).toContain("Coffeehouse");
    expect(house.textContent).not.toContain("About");
    // A missing article is named but not linked, and no trail is offered from it.
    expect(lloyds.dataset.status).toBe("missing");
    expect(within(lloyds).queryByRole("link")).toBeNull();
    expect(lloyds.textContent).toContain("not on Wikipedia");
    expect(within(market).getByRole("link", { name: "Lloyd's of London" })).toBeTruthy();
  });

  it("falls back to titles alone when metadata could not be fetched", () => {
    render(<TrailView trail={resolveTrail(curatedTrail("pencil-to-ig-nobel")!, null)} />);
    expect(cards().map((c) => c.dataset.status)).toEqual(Array(5).fill("unknown"));
    expect(screen.getByRole("link", { name: "Graphene" }).getAttribute("href")).toBe("/wiki/Graphene");
    expect(screen.getAllByTestId("trail-connection")).toHaveLength(4);
  });

  it("shows placeholders while loading", () => {
    render(<TrailView trail={resolveTrail(curatedTrail("pencil-to-ig-nobel")!, null)} loading />);
    expect(cards().every((c) => c.dataset.status === "loading")).toBe(true);
  });

  it("expands and collapses each connection, and all of them at once", async () => {
    const user = userEvent.setup();
    render(<TrailView trail={resolved("pencil-to-ig-nobel")} />);
    const toggles = screen.getAllByRole("button", { name: /How they connect/ });
    const details = screen.getAllByTestId("trail-detail");
    expect(details.every((d) => d.hidden)).toBe(true);

    await user.click(toggles[2]);
    expect(toggles[2].getAttribute("aria-expanded")).toBe("true");
    expect(details[2].hidden).toBe(false);
    expect(details[2].textContent).toContain("adhesive tape");
    expect(details[2].textContent).toContain("Source: Graphene links to Andre Geim on Wikipedia.");
    expect(details[0].hidden).toBe(true);

    await user.click(screen.getByRole("button", { name: "Expand all connections" }));
    expect(details.every((d) => !d.hidden)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Collapse all connections" }));
    expect(details.every((d) => d.hidden)).toBe(true);
  });

  it("quotes Wikipedia's sentence for generated steps", () => {
    const trail: ResolvedTrail = {
      ...resolved("coffee-to-lloyds"),
      origin: "generated",
      connections: curatedTrail("coffee-to-lloyds")!.connections.map((c, i) => ({ ...c, evidence: { quote: `Quoted sentence ${i}.`, source: ["Coffee", "Coffeehouse", "Lloyd's Coffee House"][i] } })),
    };
    render(<TrailView trail={trail} />);
    fireEvent.click(screen.getAllByRole("button", { name: /How they connect/ })[1]);
    const detail = screen.getAllByTestId("trail-detail")[1];
    expect(detail.querySelector("blockquote")?.textContent).toBe("Quoted sentence 1.");
    expect(within(detail).getByRole("link", { name: "Coffeehouse" }).getAttribute("href")).toBe("/wiki/Coffeehouse");
  });
});

describe("TrailExplorer", () => {
  it("switches between destinations from the same start", async () => {
    const user = userEvent.setup();
    render(<TrailExplorer trails={all()} />);
    expect(route()).toBe("Apollo 11→ to ARPANET");
    const group = screen.getByRole("group", { name: "Trails from Apollo 11" });
    const options = within(group).getAllByRole("button");
    expect(options.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["ARPANET", "true"],
      ["V-2 rocket", "false"],
      ["Microwave oven", "false"],
    ]);
    await user.click(options[1]);
    expect(route()).toBe("Apollo 11→ to V-2 rocket");
    expect(cards()).toHaveLength(4);
    expect(within(group).getByRole("button", { name: "V-2 rocket" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("explores another trail with a different start, cycling through all of them", async () => {
    const user = userEvent.setup();
    render(<TrailExplorer trails={all()} />);
    const starts = new Set<string>();
    for (let i = 0; i < CURATED_TRAILS.length; i++) {
      starts.add(within(cards()[0]).getByRole("heading").textContent!);
      const before = route();
      await user.click(screen.getByRole("button", { name: "Explore another trail" }));
      expect(route()).not.toBe(before);
    }
    expect(starts.size).toBe(new Set(CURATED_TRAILS.map((t) => t.titles[0])).size);
  });

  it("resets expanded connections when the trail changes", async () => {
    const user = userEvent.setup();
    render(<TrailExplorer trails={all()} />);
    await user.click(screen.getByRole("button", { name: "Expand all connections" }));
    await user.click(screen.getByRole("button", { name: "Explore another trail" }));
    expect(screen.getAllByTestId("trail-detail").every((d) => d.hidden)).toBe(true);
  });

  it("shows no controls that would lead nowhere", () => {
    render(<TrailExplorer trails={[resolved("coffee-to-lloyds")]} />);
    expect(screen.queryByRole("button", { name: "Explore another trail" })).toBeNull();
    expect(screen.queryByTestId("trail-alternative")).toBeNull();
  });

  it("starts at the requested trail and labels generated trails", () => {
    const generated = { ...resolved("coffee-to-lloyds"), id: "generated-1", origin: "generated" as const };
    render(<TrailExplorer trails={[generated, ...all()]} />);
    expect(screen.getByTestId("trail-generated-note").textContent).toMatch(/AI/);
    cleanup();
    render(<TrailExplorer trails={all()} initialId="banana-to-crystal-palace" />);
    expect(route()).toBe("Banana→ to The Crystal Palace");
    expect(screen.queryByTestId("trail-generated-note")).toBeNull();
  });
});

describe("GeneratedTrails", () => {
  function mockFetch(handler: () => { status?: number; body: unknown }) {
    const fn = vi.fn(async () => {
      const { status = 200, body } = handler();
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("shows progress, then the verified trails followed by the curated ones", async () => {
    const generated = { ...resolved("coffee-to-lloyds"), id: "generated-9-1", origin: "generated" as const };
    const fetchMock = mockFetch(() => ({ body: { enabled: true, trails: [generated], rejected: 1 } }));
    render(<GeneratedTrails title="Coffee" others={all()} />);
    expect(screen.getByTestId("trail-generating").textContent).toContain("Coffee");
    await waitFor(() => expect(screen.getByTestId("trail-explorer")).toBeTruthy());
    expect(route()).toBe("Coffee→ to Lloyd's of London");
    expect(screen.getByTestId("trail-generated-note")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explore another trail" })).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/trails");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Coffee" });
  });

  it("explains when no proposed trail passed verification", async () => {
    mockFetch(() => ({ body: { enabled: true, trails: [], rejected: 3 } }));
    render(<GeneratedTrails title="Cold War" others={[]} />);
    await waitFor(() => expect(screen.getByText("No verified trail starts from Cold War yet")).toBeTruthy());
    expect(screen.getByText(/3 rejected/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cold War" }).getAttribute("href")).toBe("/wiki/Cold_War");
  });

  it("reports errors and retries", async () => {
    let calls = 0;
    mockFetch(() => (++calls === 1 ? { status: 503, body: { error: "The AI provider is busy. Try again shortly." } } : { body: { enabled: true, trails: [resolved("coffee-to-lloyds")], rejected: 0 } }));
    render(<GeneratedTrails title="Coffee" others={[]} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("The AI provider is busy"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByTestId("trail-explorer")).toBeTruthy());
    expect(calls).toBe(2);
  });
});
