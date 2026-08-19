/**
 * Builds the Android icon/splash source images from public/logo.png.
 *
 * The shipped PWA icons were all the same 679x586 non-square file, which Android
 * would letterbox into an ugly launcher icon. This derives proper square sources:
 *
 *   assets/icon-only.png        1024x1024  white plate + brand mark  (legacy icon)
 *   assets/icon-foreground.png  1024x1024  mark on transparent, inside the
 *                                          adaptive-icon safe zone (66% circle)
 *   assets/icon-background.png  1024x1024  flat white plate
 *   assets/splash.png           2732x2732  brand mark on the dark app background
 *   assets/splash-dark.png      2732x2732  identical (the app is dark either way)
 *
 * The wordmark is deliberately dropped from the icon and splash: at launcher size
 * it is unreadable, and its dark-blue letterforms have poor contrast on the dark
 * splash background. The mark alone is legible at every size.
 *
 *   node scripts/make-app-assets.mjs && npx @capacitor/assets generate --android
 */

import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "public/logo.png");
const OUT = resolve(root, "assets");
mkdirSync(OUT, { recursive: true });

/** App background, matching capacitor.config.ts and the Android launch theme. */
const DARK = { r: 0x0b, g: 0x10, b: 0x20, alpha: 1 };
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * The brand mark occupies the top band of the logo; the wordmark sits below a
 * clear horizontal gap. Measured from the source's alpha channel rather than
 * hardcoded, so a re-exported logo keeps working.
 */
async function extractMark() {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels: c } = info;
  const rowFilled = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * c + 3] > 16) n++;
    }
    rowFilled.push(n);
  }

  // First filled band top-down = the mark.
  let top = rowFilled.findIndex((n) => n > 0);
  let bottom = top;
  while (bottom + 1 < h && rowFilled[bottom + 1] > 0) bottom++;

  if (top < 0 || bottom <= top) throw new Error("Could not locate the brand mark in logo.png");

  console.log(`  mark rows ${top}..${bottom} of ${h}`);

  // Two passes on purpose: sharp fixes its operation order internally, so an
  // extract() and a trim() in the same pipeline do not compose the way the call
  // order suggests.
  const band = await sharp(SRC)
    .extract({ left: 0, top, width: w, height: bottom - top + 1 })
    .png()
    .toBuffer();

  return sharp(band).trim().png().toBuffer();
}

/** Centre `mark` on a square canvas, scaled so its longest side is `ratio` of it. */
async function plate(mark, size, background, ratio) {
  const inner = Math.round(size * ratio);
  const scaled = await sharp(mark)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: scaled, gravity: "centre" }])
    .png()
    .toBuffer();
}

const mark = await extractMark();
const markMeta = await sharp(mark).metadata();
console.log(`brand mark extracted: ${markMeta.width}x${markMeta.height}`);

// Legacy launcher icon — full-bleed white plate so it reads on any wallpaper.
await sharp(await plate(mark, 1024, WHITE, 0.7)).toFile(resolve(OUT, "icon-only.png"));

// Adaptive icon. Android crops the outer ~25%, so the mark must stay well
// inside the safe zone or the launcher will clip its corners.
await sharp(
  await plate(mark, 1024, { r: 0, g: 0, b: 0, alpha: 0 }, 0.52),
).toFile(resolve(OUT, "icon-foreground.png"));

await sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } })
  .png()
  .toFile(resolve(OUT, "icon-background.png"));

// Splash. Kept small in frame — @capacitor/assets centre-crops this square for
// every device aspect ratio, so anything large gets cut on short screens.
const splash = await plate(mark, 2732, DARK, 0.22);
await sharp(splash).toFile(resolve(OUT, "splash.png"));
await sharp(splash).toFile(resolve(OUT, "splash-dark.png"));

// Also fix the web/PWA icons, which were all the same non-square file.
await sharp(await plate(mark, 512, WHITE, 0.7)).toFile(resolve(root, "public/icon-512.png"));
await sharp(await plate(mark, 192, WHITE, 0.7)).toFile(resolve(root, "public/icon-192.png"));
await sharp(await plate(mark, 180, WHITE, 0.7)).toFile(resolve(root, "public/apple-touch-icon.png"));

console.log("✔ wrote assets/{icon-only,icon-foreground,icon-background,splash,splash-dark}.png");
console.log("✔ regenerated public/{icon-512,icon-192,apple-touch-icon}.png as true squares");
console.log("\nNext: npx @capacitor/assets generate --android");
