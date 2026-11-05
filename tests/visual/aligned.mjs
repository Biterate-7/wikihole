/**
 * Compares two captures row by row after lining them up, so content that only
 * moved down the page is not reported as changed. Prints the bands of rows found
 * in one capture and not the other, within a horizontal range.
 *
 *   node tests/visual/aligned.mjs <fileA.png> <fileB.png> [left] [right]
 */
import fs from "node:fs";
import { chromium } from "@playwright/test";

const [fileA, fileB, left = "0", right] = process.argv.slice(2);
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();

/** A hash per row. Reads in slices because a canvas cannot be as tall as a full article. */
async function rowHashes(file) {
  return page.evaluate(
    async ({ src, left, right }) => {
      const image = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = src;
      });
      const x0 = left;
      const x1 = right ?? image.width;
      const canvas = document.createElement("canvas");
      const SLICE = 4000;
      canvas.width = x1 - x0;
      canvas.height = SLICE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const hashes = [];
      for (let top = 0; top < image.height; top += SLICE) {
        const height = Math.min(SLICE, image.height - top);
        ctx.clearRect(0, 0, canvas.width, SLICE);
        ctx.drawImage(image, -x0, -top);
        const { data } = ctx.getImageData(0, 0, canvas.width, height);
        for (let y = 0; y < height; y++) {
          let hash = 2166136261;
          const start = y * canvas.width * 4;
          for (let i = start; i < start + canvas.width * 4; i += 4) {
            // Quantised, so tiny antialiasing differences do not break a row.
            hash = Math.imul(hash ^ (data[i] >> 3), 16777619);
            hash = Math.imul(hash ^ (data[i + 1] >> 3), 16777619);
            hash = Math.imul(hash ^ (data[i + 2] >> 3), 16777619);
          }
          hashes.push(hash);
        }
      }
      return hashes;
    },
    { src: dataUrl(file), left: Number(left), right: right ? Number(right) : undefined },
  );
}

const a = await rowHashes(fileA);
const b = await rowHashes(fileB);
await browser.close();

/**
 * Greedy alignment: walk both lists, and at a mismatch find the nearest pair of
 * rows where a run of 12 matches resumes. Blank rows are common, so a run must
 * contain several distinct rows to count as a real match.
 */
const RUN = 12;
function runMatches(i, j) {
  const seen = new Set();
  for (let k = 0; k < RUN; k++) {
    if (a[i + k] === undefined || a[i + k] !== b[j + k]) return false;
    seen.add(a[i + k]);
  }
  return seen.size >= 4;
}

const onlyA = [];
const onlyB = [];
let i = 0;
let j = 0;
const LIMIT = 6000;
while (i < a.length && j < b.length) {
  if (a[i] === b[j]) {
    i++;
    j++;
    continue;
  }
  let found = null;
  search: for (let distance = 1; distance <= LIMIT; distance++) {
    for (let skip = 0; skip <= distance; skip++) {
      const ni = i + skip;
      const nj = j + distance - skip;
      if (ni < a.length && nj < b.length && runMatches(ni, nj)) {
        found = [ni, nj];
        break search;
      }
    }
  }
  if (!found) break;
  if (found[0] > i) onlyA.push([i, found[0] - 1]);
  if (found[1] > j) onlyB.push([j, found[1] - 1]);
  [i, j] = found;
}
if (i < a.length) onlyA.push([i, a.length - 1]);
if (j < b.length) onlyB.push([j, b.length - 1]);

console.log(`rows: ${a.length} vs ${b.length}`);
console.log(`only in A: ${onlyA.map(([from, to]) => `${from}-${to}`).join(", ") || "none"}`);
console.log(`only in B: ${onlyB.map(([from, to]) => `${from}-${to}`).join(", ") || "none"}`);
