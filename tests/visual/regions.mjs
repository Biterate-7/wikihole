/**
 * Says where two captures differ, so a difference can be explained rather than
 * just counted: bands of changed rows, each with its horizontal extent.
 *
 *   node tests/visual/regions.mjs <fileA.png> <fileB.png>
 */
import fs from "node:fs";
import { chromium } from "@playwright/test";

const [a, b] = process.argv.slice(2);
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
const browser = await chromium.launch();
const page = await browser.newPage();
const bands = await page.evaluate(
  async ({ a: srcA, b: srcB }) => {
    const load = (src) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
    const [ia, ib] = await Promise.all([load(srcA), load(srcB)]);
    const w = Math.max(ia.width, ib.width);
    const h = Math.max(ia.height, ib.height);
    const pixels = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const da = pixels(ia);
    const db = pixels(ib);
    const out = [];
    let band = null;
    for (let y = 0; y < h; y++) {
      let min = Infinity;
      let max = -1;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) {
          if (x < min) min = x;
          if (x > max) max = x;
        }
      }
      if (max >= 0) {
        if (band && y - band.to <= 40) {
          band.to = y;
          band.left = Math.min(band.left, min);
          band.right = Math.max(band.right, max);
        } else {
          band = { from: y, to: y, left: min, right: max };
          out.push(band);
        }
      }
    }
    return out;
  },
  { a: dataUrl(a), b: dataUrl(b) },
);
for (const band of bands) console.log(`rows ${band.from}-${band.to}  x ${band.left}-${band.right}`);
if (bands.length === 0) console.log("identical");
await browser.close();
