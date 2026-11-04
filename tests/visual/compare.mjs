/**
 * Pixel-compares two capture directories in a real browser canvas.
 *
 *   node tests/visual/compare.mjs <baselineDir> <candidateDir> [diffDir]
 *
 * Exits 1 if any page differs by more than VISUAL_THRESHOLD (fraction of
 * pixels, default 0) or if the chrome fingerprints differ.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const [baseDir, candDir, diffDir] = process.argv.slice(2).map((p) => path.resolve(p));
const THRESHOLD = Number(process.env.VISUAL_THRESHOLD ?? 0);
const browser = await chromium.launch();
const page = await browser.newPage();
let failed = false;
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

for (const file of fs.readdirSync(baseDir).filter((f) => f.endsWith(".png")).sort()) {
  const candidate = path.join(candDir, file);
  if (!fs.existsSync(candidate)) {
    console.log(`MISSING ${file}`);
    failed = true;
    continue;
  }
  const result = await page.evaluate(
    async ({ a, b, wantDiff }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const pixels = (image) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, w, h);
      };
      const da = pixels(ia);
      const db = pixels(ib);
      let diff = 0;
      let firstRow = -1;
      let lastRow = -1;
      for (let i = 0; i < da.data.length; i += 4) {
        const delta =
          Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]);
        if (delta > 24) {
          diff++;
          const row = Math.floor(i / 4 / w);
          if (firstRow < 0) firstRow = row;
          lastRow = row;
          da.data[i] = 255;
          da.data[i + 1] = 0;
          da.data[i + 2] = 0;
        }
      }
      let png = null;
      if (wantDiff && diff) {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").putImageData(da, 0, 0);
        png = canvas.toDataURL("image/png");
      }
      return { diff, total: w * h, size: [ia.width, ia.height, ib.width, ib.height], firstRow, lastRow, png };
    },
    { a: dataUrl(path.join(baseDir, file)), b: dataUrl(candidate), wantDiff: Boolean(diffDir) },
  );
  const ratio = result.diff / result.total;
  const ok = ratio <= THRESHOLD && result.size[0] === result.size[2] && result.size[1] === result.size[3];
  if (!ok) failed = true;
  const rows = result.diff ? ` rows ${result.firstRow}-${result.lastRow}` : "";
  console.log(`${ok ? "ok  " : "DIFF"} ${file} ${(ratio * 100).toFixed(4)}% size ${result.size.slice(0, 2).join("x")} vs ${result.size.slice(2).join("x")}${rows}`);
  if (result.png && diffDir) {
    fs.mkdirSync(diffDir, { recursive: true });
    fs.writeFileSync(path.join(diffDir, file), Buffer.from(result.png.split(",")[1], "base64"));
  }
}

const fingerprintA = path.join(baseDir, "fingerprints.json");
const fingerprintB = path.join(candDir, "fingerprints.json");
if (fs.existsSync(fingerprintA) && fs.existsSync(fingerprintB)) {
  const a = JSON.parse(fs.readFileSync(fingerprintA, "utf8"));
  const b = JSON.parse(fs.readFileSync(fingerprintB, "utf8"));
  const same = JSON.stringify(a) === JSON.stringify(b);
  console.log(same ? "ok   fingerprints identical" : "DIFF fingerprints");
  if (!same) {
    failed = true;
    for (const key of Object.keys(a)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) console.log(`  ${key}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
