/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS preload for NODE_OPTIONS --require */
/**
 * Preloaded into `next start` by capture.mjs (via NODE_OPTIONS) so a page renders
 * from the same data on every run: Wikimedia responses are recorded once and
 * replayed, and server-side randomness is seeded. Never loaded in production.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const dir = process.env.VISUAL_RECORDING_DIR;
const mode = process.env.VISUAL_MODE ?? "replay";
if (!dir) throw new Error("VISUAL_RECORDING_DIR is required");
fs.mkdirSync(dir, { recursive: true });

let state = 0x5eed1234;
Math.random = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const realFetch = globalThis.fetch;
const isWikimedia = (url) => /(^|\.)(wikipedia|wikimedia|wikidata)\.org$/.test(new URL(url).hostname);

globalThis.fetch = async function replayFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!/^https?:/.test(url) || !isWikimedia(url)) return realFetch(input, init);
  const file = path.join(dir, `${crypto.createHash("sha1").update(url).digest("hex")}.json`);
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return new Response(saved.body, { status: saved.status, headers: { "content-type": "application/json" } });
  }
  if (mode === "replay") {
    console.error(`[replay] miss ${url}`);
    return new Response("{}", { status: 503, headers: { "content-type": "application/json" } });
  }
  const response = await realFetch(input, init);
  const body = await response.clone().text();
  if (response.ok) fs.writeFileSync(file, JSON.stringify({ url, status: response.status, body }));
  return response;
};
