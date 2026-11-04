/**
 * Generates WikiHole's favicon and app icons from the Wikipedia puzzle globe in
 * scripts/assets/wikipedia-globe-source.png (the reference image, used as is).
 *
 *   node scripts/generate-icons.mjs
 *
 * Writes:
 *   src/app/favicon.ico            16/32/48 (PNG-encoded ICO)
 *   src/app/icon1..3.png           16, 32, 48
 *   src/app/apple-icon.png         180, opaque (iOS fills transparency with black)
 *   public/icons/icon-192.png      PWA / Android home screen
 *   public/icons/icon-512.png      PWA / install splash
 *   public/icons/icon-maskable-512.png   globe inside the 80% maskable safe zone
 *
 * The source is 247x204 with a flat lavender background and a stray mark at the
 * right edge. This crops to the globe, makes the background transparent (the
 * anti-aliased rim is de-blended against the background, so there is no halo),
 * centres the globe on a square and resamples with Lanczos. Nothing is redrawn.
 * The source globe is ~200px wide, so the 512 icons are an upscale.
 *
 * Needs `sharp`, which ships with Next.js (it is not a direct dependency).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "scripts", "assets", "wikipedia-globe-source.png");

// The source's flat background, and the columns that hold the globe (right of
// this is a stray "1" from the original screenshot).
const BG = [249, 245, 254];
const GLOBE_MAX_X = 232;
const FLOOD_TOLERANCE = 3;

/** Source globe as a transparent RGBA bitmap, trimmed and centred on a square. */
async function loadGlobe() {
  const { data, info } = await sharp(SOURCE)
    .extract({ left: 0, top: 0, width: GLOBE_MAX_X, height: (await sharp(SOURCE).metadata()).height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  const at = (x, y) => (y * W + x) * 3;
  const maxDist = (i) => Math.max(Math.abs(data[i] - BG[0]), Math.abs(data[i + 1] - BG[1]), Math.abs(data[i + 2] - BG[2]));

  // 1. Flood the background in from the border (4-connected, so a diagonal gap in
  //    the rim can never let it leak into the globe).
  const outside = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H || outside[y * W + x] || maxDist(at(x, y)) > FLOOD_TOLERANCE) return;
    outside[y * W + x] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < W; x++) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y++) {
    push(0, y);
    push(W - 1, y);
  }
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // 2. Rim pixels (touching the background) are a blend of background and globe.
  //    Take the globe colour from the opaque pixels just inside, project the pixel
  //    onto the background->globe line for its coverage, and keep the globe colour.
  const rgba = Buffer.alloc(W * H * 4);
  const touchesOutside = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && outside[ny * W + nx]) return true;
      }
    }
    return false;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const i = at(x, y);
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      let a = 255;
      if (outside[y * W + x]) {
        r = g = b = a = 0;
      } else if (touchesOutside(x, y)) {
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H || touchesOutside(nx, ny)) continue;
            const j = at(nx, ny);
            sr += data[j];
            sg += data[j + 1];
            sb += data[j + 2];
            n++;
          }
        }
        if (n) {
          const fg = [sr / n, sg / n, sb / n];
          const dir = [fg[0] - BG[0], fg[1] - BG[1], fg[2] - BG[2]];
          const len2 = dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2;
          const cover = ((r - BG[0]) * dir[0] + (g - BG[1]) * dir[1] + (b - BG[2]) * dir[2]) / len2;
          a = Math.round(255 * Math.min(1, Math.max(0, cover)));
          [r, g, b] = fg;
        }
      }
      rgba[o] = Math.round(r);
      rgba[o + 1] = Math.round(g);
      rgba[o + 2] = Math.round(b);
      rgba[o + 3] = a;
    }
  }

  // 3. Trim to the globe and centre it on a square (no extra margin).
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (rgba[(y * W + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const side = Math.max(w, h);
  return sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: w, height: h })
    .extend({
      left: Math.floor((side - w) / 2),
      right: Math.ceil((side - w) / 2),
      top: Math.floor((side - h) / 2),
      bottom: Math.ceil((side - h) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** `size` x `size` PNG with the globe inset by `pad` (fraction of size) on each side. */
async function render(globe, size, { pad = 0, background } = {}) {
  const inset = Math.round(size * pad);
  const inner = size - 2 * inset;
  let image = sharp(globe)
    .resize(inner, inner, { kernel: "lanczos3" })
    .extend({ top: inset, bottom: inset, left: inset, right: inset, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (background) image = image.flatten({ background });
  // A touch of sharpening keeps the puzzle seams readable at tab sizes.
  if (size <= 48) image = image.sharpen({ sigma: 0.6 });
  return image.png({ compressionLevel: 9 }).toBuffer();
}

/** ICO container holding PNG-encoded images (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, n) => {
    const e = 6 + 16 * n;
    header[e] = size; // 0 would mean 256; every size here is below that
    header[e + 1] = size;
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

const write = (path, data) => {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`${path}  ${data.length} bytes`);
};

const globe = await loadGlobe();
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const tabSizes = [16, 32, 48];
const tab = await Promise.all(tabSizes.map(async (size) => ({ size, png: await render(globe, size, { pad: 0.02 }) })));

write("src/app/favicon.ico", ico(tab));
tab.forEach(({ png }, n) => write(`src/app/icon${n + 1}.png`, png));
write("src/app/apple-icon.png", await render(globe, 180, { pad: 0.06, background: WHITE }));
write("public/icons/icon-192.png", await render(globe, 192, { pad: 0.02 }));
write("public/icons/icon-512.png", await render(globe, 512, { pad: 0.02 }));
write("public/icons/icon-maskable-512.png", await render(globe, 512, { pad: 0.1, background: WHITE }));
