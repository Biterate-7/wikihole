/**
 * Which sidebars the reader has hidden ("hide" / "move to sidebar", as on
 * Wikipedia). The choice lives in localStorage and is mirrored as
 * data-hide-<panel> attributes on <html>, which the layout CSS reads, so
 * pages render the same on the server and nothing jumps after hydration.
 */

export const PANELS = ["main-menu", "toc", "tools"] as const;
export type Panel = (typeof PANELS)[number];

const key = (panel: Panel) => `wikihole:v1:hide:${panel}`;

/** Runs inline in <head> before first paint. */
export const PINNED_STATE_SCRIPT = `(function(){try{${JSON.stringify(PANELS)}.forEach(function(p){if(localStorage.getItem("wikihole:v1:hide:"+p)==="1")document.documentElement.setAttribute("data-hide-"+p,"")})}catch(e){}})();`;

/** Fired on window whenever a panel moves, so open dropdowns can close. */
export const PANEL_EVENT = "wikihole:panel";

export function setPanelHidden(panel: Panel, hidden: boolean): void {
  document.documentElement.toggleAttribute(`data-hide-${panel}`, hidden);
  window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: panel }));
  try {
    if (hidden) localStorage.setItem(key(panel), "1");
    else localStorage.removeItem(key(panel));
  } catch {
    // Storage unavailable: the choice lasts for this page view only.
  }
}
