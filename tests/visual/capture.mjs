/**
 * Captures every core page at desktop and mobile width from a production build
 * with recorded Wikimedia data (see replay-preload.cjs), plus a fingerprint of
 * the chrome's geometry and computed styles.
 *
 *   node tests/visual/capture.mjs <outDir> [--record]
 *
 * Long article sections skip painting off screen (content-visibility), so they
 * come out blank in a full-page capture. Set VISUAL_PAINT_ALL=1 to paint them, for
 * comparing the middle of an article between two builds.
 *
 * Run `npm run build` first. Wikimedia recordings live in tests/visual/.recording.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
if (!process.argv[2]) throw new Error("usage: capture.mjs <outDir> [--record]");
const outDir = path.resolve(process.argv[2]);
const record = process.argv.includes("--record");
const PORT = Number(process.env.VISUAL_PORT ?? 3210);
const base = `http://localhost:${PORT}`;

const PAGES = [
  { name: "home", path: "/", ready: "h1" },
  { name: "discover", path: "/discover", ready: '[data-testid="feed-item"]' },
  { name: "topics", path: "/topics", ready: "h1" },
  { name: "topic-group", path: "/topics/computer-science", ready: "h1" },
  { name: "search", path: "/search?q=enigma%20machine", ready: "h1" },
  { name: "saved", path: "/saved", ready: "h1" },
  { name: "article", path: "/wiki/Antikythera_mechanism", ready: "h1" },
  { name: "article-de", path: "/de/wiki/Turingmaschine", ready: "h1" },
];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
// Sampled to prove typography, spacing and colours survive, even where content differs.
const FINGERPRINT = [
  "header",
  "h1",
  "nav[aria-label='Main menu']",
  "nav[aria-label='Namespaces']",
  "nav[aria-label='Views']",
  "#page-tools",
  "input[type='search']",
];

async function waitUp(url) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not start: ${url}`);
}

fs.mkdirSync(outDir, { recursive: true });
const preload = pathToFileURL(path.join(here, "replay-preload.cjs")).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "--port", String(PORT)], {
  cwd: root,
  stdio: ["ignore", "ignore", "pipe"],
  env: {
    ...process.env,
    NODE_OPTIONS: `--require "${preload}"`,
    VISUAL_RECORDING_DIR: path.join(here, ".recording"),
    VISUAL_MODE: record ? "record" : "replay",
  },
});
const misses = [];
server.stderr.on("data", (chunk) => {
  const text = String(chunk);
  if (text.includes("[replay] miss")) misses.push(text.trim());
});

const fingerprints = {};
const browser = await chromium.launch();
try {
  await waitUp(`${base}/api/health`);
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      reducedMotion: "reduce",
      deviceScaleFactor: 1,
    });
    await context.addInitScript(() => {
      let s = 42;
      Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    });
    for (const target of PAGES) {
      const page = await context.newPage();
      await page.goto(base + target.path, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => {});
      await page.locator(target.ready).first().waitFor({ timeout: 60_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      if (process.env.VISUAL_PAINT_ALL === "1") {
        await page.addStyleTag({ content: "* { content-visibility: visible !important; }" });
      }
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(outDir, `${target.name}-${viewport.name}.png`),
        fullPage: true,
        timeout: 300_000,
        animations: "disabled",
        mask: [page.locator("canvas")],
      });
      fingerprints[`${target.name}-${viewport.name}`] = await page.evaluate((selectors) => {
        const out = {};
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          out[selector] = {
            box: [r.x, r.y, r.width].map((n) => Math.round(n * 10) / 10),
            font: `${s.fontFamily}|${s.fontSize}|${s.fontWeight}|${s.lineHeight}`,
            color: `${s.color}|${s.backgroundColor}`,
          };
        }
        const body = getComputedStyle(document.body);
        out.body = {
          font: `${body.fontFamily}|${body.fontSize}`,
          color: `${body.color}|${body.backgroundColor}`,
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
        return out;
      }, FINGERPRINT);
      await page.close();
      console.log(`captured ${target.name}-${viewport.name}`);
    }
    await context.close();
  }
  fs.writeFileSync(path.join(outDir, "fingerprints.json"), JSON.stringify(fingerprints, null, 1));
  if (misses.length) console.log(`${misses.length} replay misses:\n${misses.slice(0, 10).join("\n")}`);
} finally {
  await browser.close();
  server.kill();
}
