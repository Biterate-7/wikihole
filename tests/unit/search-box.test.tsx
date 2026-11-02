// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchBox } from "@/components/search/SearchBox";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const RESULTS = [
  { pageId: 1, title: "Halting problem", description: "Problem in computer science", length: 56000, disambiguation: false },
  { pageId: 2, title: "Halting (disambiguation)", length: 900, disambiguation: true },
];

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => push.mockReset());
afterEach(() => cleanup());

describe("SearchBox", () => {
  it("debounces, shows Wikipedia results, and supports keyboard navigation", async () => {
    const fetchMock = mockFetch({ results: RESULTS });
    const user = userEvent.setup();
    render(<SearchBox />);
    const input = screen.getByRole("combobox");
    await user.type(input, "halting");

    await screen.findByText("Halting problem");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Halting problem"),
      expect.stringContaining("Disambiguation"),
      expect.stringContaining("All results"),
    ]);
    // Typing seven characters triggers a single debounced request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/api/search?q=halting");

    await user.keyboard("{ArrowDown}");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/wiki/Halting_problem");
  });

  it("opens the full results page on Enter without a selection", async () => {
    mockFetch({ results: RESULTS });
    const user = userEvent.setup();
    render(<SearchBox />);
    await user.type(screen.getByRole("combobox"), "busy beaver");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/search?q=busy%20beaver");
  });

  it("closes the results on Escape and calls onEscape when already closed", async () => {
    mockFetch({ results: RESULTS });
    const onEscape = vi.fn();
    const user = userEvent.setup();
    render(<SearchBox onEscape={onEscape} />);
    await user.type(screen.getByRole("combobox"), "turing");
    await screen.findAllByRole("option");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onEscape).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("shows empty and error states", async () => {
    mockFetch({ results: [] });
    const user = userEvent.setup();
    render(<SearchBox />);
    await user.type(screen.getByRole("combobox"), "qwxzvbnm");
    expect(await screen.findByText(/No articles match/)).toBeTruthy();
    cleanup();

    mockFetch({ error: "Wikipedia is unavailable right now. Try again shortly." }, 502);
    render(<SearchBox />);
    await user.type(screen.getByRole("combobox"), "entropy");
    await waitFor(() => expect(screen.getByText(/Wikipedia is unavailable/)).toBeTruthy());
  });

  it("does not search for queries shorter than two characters", async () => {
    const fetchMock = mockFetch({ results: RESULTS });
    const user = userEvent.setup();
    render(<SearchBox />);
    await user.type(screen.getByRole("combobox"), "a");
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
